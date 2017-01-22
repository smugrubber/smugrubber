var config = {
    port: 3070,
 
    //should we console.log everything?
    verbose: true,
 
    // ip addresses allowed to admin
    whitelist: ['127.0.0.1'],

    // store connection data
    rtc_peer_connection_options: {
        'iceServers': [{
            'url': 'stun:stun.l.google.com:19302'
        }]
    },

    // how our connection set up
    data_channel_options: {
        ordered: false,          // no guaranteed delivery, unreliable but faster
        maxRetransmitTime: 1000, // ms
    }
};
 
module.exports = config;
