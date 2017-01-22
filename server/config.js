var config = {
    port: 3070,
 
    //should we console.log everything?
    verbose: true,
 
    //ip addresses allowed to add & modify users
    whitelist: ['127.0.0.1'],

    ice_servers: [
        'stun:stun.l.google.com:19302'
    ]
};
 
module.exports = config;
