const { Configuration, OpenAIApi } = require("openai");
const { login } = require("masto");


const main = async () => {
  let masto;
  try {
    masto = await login({
      url: 'https://wargamers.social',
      accessToken: process.env.MAST_API_KEY,
    });
  } catch (err) {
    console.log('Unable to connect to the wargamers.social instance.');
    console.log(err.message);
    return;
  }

  // Initialize a Map to track if users need to be rate throttled
  let requestMap = new Map();  

  // Attach to the @bot user timeline
  const stream = await masto.v1.stream.streamUser();

  // Subscribe to notifications
  stream.on('notification', (notification) => {  
    let url = new URL(notification.account.url);
    let hostname = url.hostname;
    let user = `@${notification.account.username}@${hostname}`;

    // We only support users on the wargamers.social instance  
    if (hostname != 'wargamers.social') {
      console.log(`${user} is not a user on the wargamers.social instance.`)
      // TODO: Send DM to user indicating other hostnames are not supported
      return;
    }

    let statusId = notification.status.id;
    let type = notification.type;
    let visibility = notification.status.visibility; 
    let numberOfUsersMentioned = notification.status.mentions.length; 
    
    // Reply to direct messages to @bot account only
    if (type == "mention" && visibility == "direct" && numberOfUsersMentioned == 1) {    
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

      fetchAndSendResponse(masto, prompt, user, statusId);
    }
  });
};

const fetchAndSendResponse = async (masto, prompt, user, statusId) => {
  const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  });
  const openai = new OpenAIApi(configuration);

  let completion;
  let response;
  try {
    completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: prompt,
    });
    response = `${user} ${completion.data.choices[0].message.content}`;
  } catch (err) {
    console.log('Error communicating with openai.');
    console.log(err.message);
    response = "I'm having trouble answering your question. Please try asking again.";
  }
  
  let status;
  try {
    status = await masto.v1.statuses.create({
      status: response,
      visibility: 'direct',
      inReplyToId: statusId,
    });
  } catch (err) {
    console.log('Error sending response to user.');
    console.log(err.message);
  }
};

main();