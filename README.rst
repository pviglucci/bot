====
Bot
====

A simple example of Node.js ChatGPT-based Mastodon bot.

This version has been written to serve as an assistant for a Mastodon instance. However,
any user can use it to create a private bot for themselves without much modification.

You can send the bot a direct message and it'll respond with a direct message back to you.
Bot is based on the GPT LLM from OpenAI and supports the gpt-3.5-turbo and gpt-4 models.

Consider this an alpha project for testing that may break.

This is for fun. LLM are good at inventing facts. Don't rely on it for anything important.

Characteristics
---------------
1) Bot will only respond to direct messages where the bot account is the sole recipient
2) Bot will only respond to accounts on a specififed instance
3) Bot has conversational state but it limited to one conversation at a time per user
4) Bot keeps all state in memory but can be easily modified for Redis or a database
5) Bot does not retain or log more information than needed to preserve user privacy

Configuration
-------------
Bot is configured through environment variables. The following variables are available::
    
    # The URL of the instance
    MAST_INSTANCE_URL
    
    # The API key from the Mastodon application 
    MAST_API_KEY
    
    # Configurable max toot size for those instances that have changed the default
    MAST_MAX_TOOT_SIZE
    
    # Your OpenAPI API key
    OPENAI_API_KEY
    
    # The model to use (gpt-3.5-turbo, gpt-4)
    OPENAI_MODEL
    
    # Configurable request token size for finer grained control over conversation length
    OPENAI_MAX_REQUEST_TOKENS
    
    # The max tokens of the response
    # 1 token = ~4 English characters 
    OPENAI_MAX_COMPLETION_TOKENS
    
    # Max requests a user can make over a period
    OPENAI_RATE_LIMIT
    
    # The period represented in hours
    OPENAI_RATE_PERIOD
        
    # The system message of the model
    OPENAI_SYSTEM_MESSAGE

See the systemd service file that can be used on Linux systems. Non-linux systems can 
be configured by setting the environment variables before launching.

A systemd file might include something like this::
    
    Environment=MAST_INSTANCE_URL=https://wargamers.social
    Environment=MAST_API_KEY=<KEY HERE>
    Environment=MAST_MAX_TOOT_SIZE=2000
    Environment=OPENAI_API_KEY=<KEY HERE>
    Environment=OPENAI_MODEL=GPT-3.5-TURBO
    Environment=OPENAI_MAX_REQUEST_TOKENS=3072
    Environment=OPENAI_MAX_COMPLETION_TOKENS=250
    Environment=OPENAI_RATE_LIMIT=200
    Environment=OPENAI_RATE_PERIOD=24
    Environment=OPENAI_SYSTEM_MESSAGE="A friendly assistant to help understand Mastodon. Be brief."

Bot and Privacy
---------------

The code that underlies Bot does four things:

1) Listens to the Bot's notification timeline and identifies when Bot receives a DM
2) Formats and submits the question to ChatGPT via an API call to the OpenAI servers
3) Sends a DM With the response back to the user
4) Keeps conversational state in memory to allow for follow-up interactions

The privacy implication is that the Bot account, like any other, has a timeline of direct messages. 
Instance admins can access those DMs.

That's true for everything on an instance of course, but posts where users search for 
information feels more personal than the typical.

I encourage you to be transparanet with your users so they can decide if and how you interact with Bot.

Here are steps I've taken and commitments I've made to users on my instance:  

1) Bot is an unmonitored account
2) All Bot's posts are deleted after 1 week
3) Posts that a user favorites are retained - users decide if posts are retained or not. 
4) Users can delete their posts whenever they want.

License
-------

Copyright (c) 2023 Peter J. Viglucci

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.