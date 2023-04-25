const { Configuration, OpenAIApi } = require("openai");
const { login } = require("masto");
const { encoding_for_model } = require("@dqbd/tiktoken");

const getTokenCountFromPrompt = async (prompt, model = 'gpt-3.5-turbo') => {
  /**
   * Count tokens in a prompt
   * Converted from Python code provided in the openai cookbook
   * https://github.com/openai/openai-cookbook/blob/main/examples/How_to_count_tokens_with_tiktoken.ipynb
   */
  let encoding;
  try {
    encoding = encoding_for_model(model)
  }
  catch {
    return null;
  }

  let tokensPerMessage;
  let tokensPerName;
  if (model == "gpt-3.5-turbo") {
    tokensPerMessage = 4;
    tokensPerName = -1;
  } else if (model == "gpt-4") {
    tokensPerMessage = 3
    tokensPerName = 1
  } else {
    return null;
  }

  let numTokens = 0;
  for (index in prompt) {
    numTokens = numTokens + tokensPerMessage;
    for (key in prompt[index]) {
      numTokens = numTokens + encoding.encode(prompt[index][key]).length;
      if (key == "name") {
        numTokens = numTokens + tokensPerName;
      }
    }
  }
  numTokens = numTokens + 3;
  return numTokens;
};

const connectToMastodonInstance = async (instanceUrl, instanceAccessToken) => {
  /**
   * Connect to the Mastodon instance
   */
  let masto;
  try {
    masto = await login({
      url: instanceUrl,
      accessToken: instanceAccessToken,
    });
    return masto;
  } catch {
    console.log(`Error connecting to the ${instanceUrl} instance`);
    return null;
  }
};

const sendDirectMessageToUser = async (masto, message, user, replyToStatusId, maxTootSize = 500) => {
  /**
   * Send a response to a user. Confirm the response size is not > than the 
   * instance max before sending.  
   */
  const response = `${user} ${message}`;

  if (response.length > maxTootSize) {
     response = response.substring(0, maxTootSize);
  }

  let status;
  try {
    status = await masto.v1.statuses.create({
      status: response,
      visibility: 'direct',
      inReplyToId: replyToStatusId,
    });
    return status;
  } catch {
    console.log('Error sending response to user');
    return null;
  }
};

const fetchResponseFromOpenAi = async (prompt, openai, model = 'gpt-3.5-turbo') => {
  let completion;
  try {
    completion = await openai.createChatCompletion({
      model: model,
      messages: prompt,
      max_tokens: 250,
    });
    return completion.data.choices[0].message.content;
  } catch {
    console.log('Error communicating with openai');
    return null;
  }
};

const main = async () => {
  // Set the Mastodon instance and connect
  let instanceUrl = process.env.MAST_INSTANCE_URL;
  if (!instanceUrl) {
    console.log('Unable to determine the Mastodon instance URL');
    return;
  }

  instanceUrl = instanceUrl.toLowerCase();
  const instanceUrlObj = new URL(instanceUrl);
  const instanceHostname = instanceUrlObj.hostname;
  console.log(`Instance Hostname: ${instanceHostname}`);

  const masto = await connectToMastodonInstance(instanceUrl, process.env.MAST_API_KEY);
  if (!masto) {
    console.log('Unable to connect to the Mastodon instance')
    return;
  }

  // Set up the openai configuration to be used for completions 
  const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  });
  const openai = new OpenAIApi(configuration);

  // Set the GPT model to use
  let model = process.env.OPENAI_MODEL;
  if (!model) {
    console.log('Unable to determine the model to use');
    return;
  }

  model = model.toLowerCase();
  if (model != 'gpt-3.5-turbo' && model != 'gpt-4') {
    console.log('Unsupported GPT model');
    return;
  }
  console.log(`Model: ${model}`);

  // Set the model system message to guide the conversations
  const systemMessage = process.env.OPENAI_SYSTEM_MESSAGE;
  if (!systemMessage) {
    console.log('Unable to determine the system message');
    return;
  }
  console.log(`System Message: ${systemMessage}`);

  // Set the Mastodon instance max toot size
  const maxTootSize = parseInt(process.env.MAST_MAX_TOOT_SIZE);
  if (!maxTootSize) {
    console.log('Unable to determine MAST_MAX_TOOT_SIZE');
    return;
  }
  console.log(`Max Toot Size: ${maxTootSize}`);
  
  // Set the OpenAI request tokens
  // Use to control the API costs associated with conversations
  let maxRequestTokens = parseInt(process.env.OPENAI_MAX_REQUEST_TOKENS);
  if (!maxRequestTokens) {
    if (model == 'gpt-3.5-turbo') {
      maxRequestTokens = 4096;
    } else {
      // gpt-4
      maxRequestTokens = 8192;
    }
  }
  console.log(`Max Request Tokens: ${maxRequestTokens}`);

  // Set the OpenAI max completion tokens
  // Important to allow for the fact that 1 token = ~4 english characters
  // Leave room for the imprecision in the conversions
  const maxCompletionTokens = parseInt(process.env.OPENAI_MAX_COMPLETION_TOKENS);
  if (!maxCompletionTokens) {
    console.log('Unable to determine OPENAI_MAX_COMPLETION_TOKENS');
    return;
  }
  console.log(`Max Completion Tokens: ${maxCompletionTokens}`);

  // Set the OpenAI rate limit
  let rateLimit = parseInt(process.env.OPENAI_RATE_LIMIT);
  if (!rateLimit) {
    rateLimit = 200;
  }
  console.log(`Rate Limit: ${rateLimit}`);

  // Set the OpenAI rate period in hours
  let ratePeriod = parseInt(process.env.OPENAI_RATE_PERIOD);
  if (!ratePeriod) {
    ratePeriod = 24;
  }
  let adjRatePeriod = 1000 * 60 * 60 * ratePeriod;
  console.log(`Rate Period (hrs): ${ratePeriod}`);

  // Initialize a Map to track if users need to be rate throttled
  let requestMap = new Map();

  // Initialize a Map to track conversation state
  let conversationMap = new Map();

  // Both Maps can be implemented in Redis rather that in memory
  // Be mindful of user's privacy if this is used to support an instance

  // Attach to the user timeline
  const stream = await masto.v1.stream.streamUser();

  // Subscribe to notifications
  stream.on('notification', async (notification) => {
    let url = new URL(notification.account.url);
    let hostname = url.hostname;
    let user = `@${notification.account.username}@${hostname}`;

    let statusId = notification.status.id;
    let replyId = notification.status.inReplyToId;
    let type = notification.type;
    let visibility = notification.status.visibility;
    let numberOfUsersMentioned = notification.status.mentions.length;

    // Reply to direct messages only
    if (type == "mention" && visibility == "direct" && numberOfUsersMentioned == 1) {
      // Only support users on the provided instance
      if (hostname != instanceHostname) {
        console.log(`${user} is not a user on the ${instanceHostname} instance.`);
        let message = `Sorry, at this time I only support the ${instanceHostname} instance.`;
        let status = sendDirectMessageToUser(masto, message, user, statusId);
        return;
      }

      // We only allow a fixed number of requests over a period
      let now = new Date();

      // Determine if the user needs to be throttled
      if (requestMap.has(user)) {
        // User exists in the Map
        let u = requestMap.get(user);
        let count = u.count;
        let start = u.start;
        if (count < rateLimit) {
          // User is under the rate limit, increment and continue
          requestMap.set(user, { start: start, count: count + 1 });
        } else {
          // User is OVER the rate limit, check if the period expired
          if (now - start > adjRatePeriod) {
            // The period has expired and the count can be been reset
            requestMap.set(user, { start: now, count: 1 });
          } else {
            console.log(`${user} exceeded rate limit and is throttled until the period expires`);
            return;
          }
        }
      } else {
        // Add user to the Map and continue
        requestMap.set(user, { start: now, count: 1 });
      }

      // Good to proceed
      console.log(`User: ${user}, Type: ${type}, ID: ${statusId}`);

      // Clean up the user's question by striping HTML, account reference, and padding
      let question = notification.status.content.replace(/(<([^>]+)>)/ig, '');
      question = question.replace(/\@bot/ig, '');
      question = question.trim();

      // Construct the prompt
      let prompt;
      let statusMap = new Map();

      // Determine if we are replying to an existing conversation
      if (replyId) {
        if (conversationMap.has(user)) {
          statusMap = conversationMap.get(user);   
          if (statusMap.has(replyId)) {
            // We are replying to an existing conversation
            console.log('Continuing an existing conversation');
            // Get by value to preserve the context at different points in the conversation
            // A user can reply to any message in the thread and get the context at that point
            prompt = statusMap.get(replyId).slice();

            // Append the new question
            prompt.push({role: 'user', content: question}); 
          } else {
            // The user responded to an old thread, start a new conversation
            statusMap = new Map();
          }
        }  
      }
      
      if (!prompt) {
        // This is a new conversation
        console.log('Starting a new conversation');
        prompt = [
          {
            role: "system",
            content: systemMessage
          },
          {
            role: "user",
            content: question
          },
        ];
      }

      // Adjust the prompt to be within the token limit of the model with space to fit the completion
      while (await getTokenCountFromPrompt(prompt, model) > maxRequestTokens) {
        if (prompt.length == 1) {
          break;
        }
        prompt.splice(1, 1);
      };

      let response = await fetchResponseFromOpenAi(prompt, openai, model);
      
      if (!response) {
        response = 'I\'m have trouble answering, please try asking again.';
      }
      let status = await sendDirectMessageToUser(masto, response, user, statusId, maxTootSize);

      // Save the conversation state
      prompt.push({role: 'assistant', content: response});
      statusMap.set(status.id, prompt);
      conversationMap.set(user, statusMap);
    }    
  });
};

main();