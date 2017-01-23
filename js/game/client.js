var client = {
    rtc_peer_conn: null,
    data_channel: null,
    socket: null,
    verbose: true,

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
        if(client.verbose) {
            console.log('receive_data_channel_message: ' + evt.data);
        }
        client.parse_client_message(evt.data);
    },

    init: function() {
        client.socket = new WebSocket("ws://" + settings.server.signal_server, "protocolOne");

        client.socket.onopen = function(evt) {
            client.rtc_peer_conn = new RTCPeerConnection(settings.server.rtc_peer_connection_options, null);
            client.data_channel  = client.rtc_peer_conn.createDataChannel('textMessages', settings.server.data_channel_options);
            client.data_channel.onopen = function() {
                if(client.verbose) {
                    console.log('data_channel_state_changed');
                }

                if(client.data_channel.readyState === 'open') {
                    client.data_channel.onmessage = client.receive_data_channel_message;
                }
            };

            client.rtc_peer_conn.ondatachannel = function(evt) {
                if(client.verbose) {
                    console.log('receive_data_channel');
                }

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
            if(client.verbose) {
                console.log(data);
            }

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
    },

    parse_client_message: function(msg) {
        if(client.verbose) {
            console.log('parse_client_message');
            console.log(msg);
        }

        try {
            var data = JSON.parse(msg);
        } catch(e) {
            console.log('err :: bad_json');
            return;
        }

        if(typeof data.type === 'undefined') {
            console.log('err :: type_not_defined');
            return;
        }

        switch(data.type) {
            case 'hello': handle_hello(data); break;
            case 'step':  handle_step(data);  break;
            default:
                console.log('err :: type_not_found');
                break;
        }
    },
};
client.init();

function handle_hello(data)
{
    if(client.verbose) {
        console.log('handle_hello');
    }

    game.boundary = data.boundary;
    game.iteration = data.iteration;
    game.generate_boundary_gl_buffers();

    for(var i=0; i<data.asteroids.length; ++i) {
        game.create_asteroid_from_server(data.asteroids[i]);
        console.log("added an asteroid");
    }

    for(var i=0; i<data.ninjas.length; ++i) {
        game.create_ninja_from_server(data.ninjas[i]);
        console.log("added a ninja");
    }
    for(var i=0; i<data.crates.length; ++i) {
        game.create_crate_from_server(data.crates[i]);
        console.log("added a crate");
    }
    for(var i=0; i<data.spawnpoints.length; ++i) {
        game.create_spawnpoint_from_server(data.spawnpoints[i]);
        console.log("added a spawnpoint");
    }

    game.generate_boundary_gl_buffers();
    game.generate_asteroid_gl_buffers();


    game.ninja = game.ninja_human_controller(game.ninjas[data.ninja_id]);
    game.camninja = game.ninjas[data.ninja_id];

    game.in_game = true;
    window.requestAnimationFrame(game.render);
}

function handle_step(data)
{
    if(client.verbose) {
        console.log('handle_step');
    }

    if(data.iteration < game.iteration) {
        if(client.verbose) {
            console.log('server iteration less than game');
        }

        return;
    }

    for(var i=0; i<data.ninjas.length; ++i) {
        game.ninjas[data.ninjas[i].id].body.SetTransform(new Box2D.b2Vec2(data.ninjas[i].x, data.ninjas[i].y), 0);
        game.ninjas[data.ninjas[i].id].body.SetLinearVelocity(new Box2D.b2Vec2(data.ninjas[i].px, data.ninjas[i].py));
        console.log("moved a ninja");
    }

}
