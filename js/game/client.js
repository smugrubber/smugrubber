var client = {
    rtc_peer_conn: null,
    data_channel: null,
    socket: null,

    log_error: function(e) {
        console.log(e);
    },

    send_local_desc: function(desc) {
        client.rtc_peer_conn.setLocalDescription(desc, function () {
            client.socket.send(JSON.stringify({
                "emit":"signal",
                "type":"SDP",
                "message": {
                    'sdp': client.rtc_peer_conn.localDescription
                }
            }));
        }, client.log_error);
    },


    receive_data_channel_message: function(evt) {        
        console.log('receive_data_channel_message: ' + evt.data);
        client.parse_client_message(evt.data);
    },

    parse_client_message: function(msg) {
        console.log('parse_client_message');
        console.log(msg);
    },

    init: function() {
        client.socket = new WebSocket("ws://" + settings.server.signal_server, "protocolOne");

        client.socket.onopen = function(evt) {
            client.rtc_peer_conn = new RTCPeerConnection(settings.server.rtc_peer_connection_options, null);
            client.data_channel  = client.rtc_peer_conn.createDataChannel('textMessages', settings.server.data_channel_options);
            client.data_channel.onopen = function() {
                console.log('data_channel_state_changed');

                if(client.data_channel.readyState === 'open') {
                    client.data_channel.onmessage = client.receive_data_channel_message;
                }
            };

            client.rtc_peer_conn.ondatachannel = function(evt) {
                console.log('receive_data_channel');

                client.data_channel = evt.channel;
                client.data_channel.onmessage = client.receive_data_channel_message;
            };

            // send any ice candidates to the other peer
            client.rtc_peer_conn.onicecandidate = function (evt) {
                if(evt.candidate) {
                    client.socket.send(JSON.stringify({
                        "emit": "signal",
                        "type":"ice_candidate",
                        "message": {
                            'candidate': evt.candidate
                        },
                        "room": "textMessages"
                    }));
                }
            };

            // let the 'negotiationneeded' event trigger offer generation
            client.rtc_peer_conn.onnegotiationneeded = function() {
                client.rtc_peer_conn.createOffer(client.send_local_desc, client.log_error);
            }
        };

        client.socket.onmessage = function(evt) {
            var data = JSON.parse(evt.data);
            console.log(data);

            if(data.emit == "signal") {
                if(data.type == "SDP") {
                    if(data.message.sdp) {
                        client.rtc_peer_conn.setRemoteDescription(new RTCSessionDescription(data.message.sdp), function () {
                            // if we received an offer, we need to answer
                            if(client.rtc_peer_conn.remoteDescription.type == 'offer') {
                                client.rtc_peer_conn.createAnswer(client.send_local_desc, client.log_error);
                            }
                        }, client.log_error);
                    }
                }        
                if(data.type == "ice_candidate") {
                    client.rtc_peer_conn.addIceCandidate(new RTCIceCandidate(data.message.candidate));
                }
            }
        };
    },

    send: function(data) {
        client.data_channel.send(JSON.stringify(data));
    }
};

client.init();

