const { Configuration, OpenAIApi } = require("openai");
const { login } = require("masto");

const connectToMastodonInstance = async (instanceUrl, instanceAccessToken) => {
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

const sendDirectMessageToUser = async (masto, message, user, replyToStatusId) => {
  // TODO: validate message < 2000 characters
  const response =`${user} ${message}`;
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

const fetchResponseFromOpenAi = async (prompt, openai) => {
  let completion;
  try {
    completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: prompt,
    });
    return completion.data.choices[0].message.content;
  } catch {
    console.log('Error communicating with openai');
    return null;
  }
};

const main = async () => {
  // Connect to Mastodon
  const masto = await connectToMastodonInstance('https://wargamers.social', process.env.MAST_API_KEY);
  
  if (!masto) {
    return;
  }

  const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  });
  const openai = new OpenAIApi(configuration);

  // Initialize a Map to track if users need to be rate throttled
  let requestMap = new Map();  

  // Attach to the @bot user timeline
  const stream = await masto.v1.stream.streamUser();

  // Subscribe to notifications
  stream.on('notification', async (notification) => {  
    let url = new URL(notification.account.url);
    let hostname = url.hostname;
    let user = `@${notification.account.username}@${hostname}`;

    let statusId = notification.status.id;
    let type = notification.type;
    let visibility = notification.status.visibility; 
    let numberOfUsersMentioned = notification.status.mentions.length; 
    
    // Reply to direct messages to @bot account only
    if (type == "mention" && visibility == "direct" && numberOfUsersMentioned == 1) {
      // We only support users on the wargamers.social instance  
      if (hostname != 'wargamers.social') {
        console.log(`${user} is not a user on the wargamers.social instance.`)
        let message = 'Sorry, at this time I only support the wargamers.social instance.';
        let status = await sendDirectMessageToUser(masto, message, user, statusId);
        return;
      }

      // We only allow a fixed number of requests over a period
      let rateLimit = 200; // TODO: Make rateLimit and period environment variables
      let period = 1000*60*60*24; // 24 hours
      let now = new Date();

      // Determine if the user needs to be throttled
      if (requestMap.has(user)) {
        // User exists in the Map
        let u = requestMap.get(user);
        let count = u.count;
        let start = u.start;
        if (count < rateLimit) {
          // User is under the rate limit, increment and continue
          requestMap.set(user, {start: start, count: count + 1});
        } else {
          // User is OVER the rate limit, check if the period expired
          if (now - start > period) {
            // The period has expired and the count can be been reset
            requestMap.set(user, {start: now, count: 1});
          } else {
            console.log(`${user} exceeded rate limit and is throttled until the period expires`);
            return;
          }
        }
      } else {
        // Add user to the Map and continue
        requestMap.set(user, {start: now, count: 1});
      }

      // Good to proceed
      console.log(`User: ${user}, Type: ${type}, ID: ${statusId}`);
      
      // Clean up the user's question by striping HTML, account reference, and padding
      let question = notification.status.content.replace(/(<([^>]+)>)/ig, '');
      question = question.replace(/\@bot/ig, '');
      question = question.trim();
      
      // Create the prompt for ChatGPT
      let prompt = [
        { 
          role: "system", 
          content: "A friendly assistant to help understand Mastodon and board wargames. Be brief and answer in 500 characters or less."
        },
        { 
          role: "user", 
          content: question
        },
      ];

      let response = await fetchResponseFromOpenAi(prompt, openai);
      
      if (!response) {
        let message = 'I\'m have trouble answering, please try asking again.';
        let status = await sendDirectMessageToUser(masto, message, user, statusId);
        return;
      }

      let status = await sendDirectMessageToUser(masto, response, user, statusId);  
    }
  });
};

main();