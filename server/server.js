#!/usr/bin/env node


const config    = require('./config');
const webrtc    = require('wrtc');
const WebSocket = require('ws');
const game      = require('./game');

var RTCPeerConnection     = webrtc.RTCPeerConnection;
var RTCSessionDescription = webrtc.RTCSessionDescription;
var RTCIceCandidate       = webrtc.RTCIceCandidate;

/**********************************
 *
 * INITIALIZE SERVER
 *
 *********************************/
var server = {
    // list of all ws connections
    // we can use this for broadcast
    ws_con_list: [],
    // these maps are referenced by ws
    // which allows them to have unique identifier
    rtc_peer_conns: {},
    data_channels:  {},
    users: {}, // contains ninja_id

    wss: null,

    // convenience function for ws
    log_error: function(e)
    {
        console.log(e);
    },

    init: function() {
        server.wss = new WebSocket.Server({ port: config.port }),
        console.log('smugrubber realtime server started on 127.0.0.1:' + config.port);


        // listen for websocket connections
        // we use this to be able to create a rtc connection
        server.wss.on('connection', function connection(ws) {
            server.ws_con_list.push(ws);

            function receive_data_channel_message(ws, evt)
            {
                if(config.verbose) {
                    console.log('receive_data_channel_message: ' + evt.data);
                }

                server.parse_client_message(ws, evt.data);
            }


            // SETUP NEW CONNECTION AND NEW DATA CHANNEL
            server.rtc_peer_conns[ws] = new RTCPeerConnection(config.rtc_peer_connection_options, null);

            server.rtc_peer_conns[ws].ondatachannel = function(evt) {
                if(config.verbose) {
                    console.log('receive_data_channel');
                }

                server.data_channels[ws] = evt.channel;
                server.data_channels[ws].onmessage = function(evt) {
                    receive_data_channel_message(ws, evt);
                };
            };

            server.data_channels[ws] = server.rtc_peer_conns[ws].createDataChannel('textMessages', config.data_channel_options);
            server.data_channels[ws].onopen = function() {
                if(config.verbose) {
                    console.log('data_channel_state_changed: ' + this.readyState);
                }

                if(this.readyState === 'open') {
                    this.onmessage = function(evt) {
                        receive_data_channel_message(ws, evt);
                    }
                }
            };


            // LISTEN FOR SIGNAL CONNECT NEGOTIATION
            ws.on('message', function incoming(message) {
                if(config.verbose) {
                    console.log('received: ' + message);
                }

                var data = JSON.parse(message);
                if(data.emit == "signal") {
                    if(data.type == "SDP") {
                        server.rtc_peer_conns[ws].setRemoteDescription(new RTCSessionDescription(data.message.sdp), function () {
                            // if we received an offer, we need to answer
                            if(server.rtc_peer_conns[ws].remoteDescription.type == 'offer') {
                                server.rtc_peer_conns[ws].createAnswer(function(desc) {
                                    server.rtc_peer_conns[ws].setLocalDescription(desc, function () {
                                        ws.send(JSON.stringify({
                                            "emit":"signal",
                                            "type":"SDP",
                                            "message": {
                                                'sdp': server.rtc_peer_conns[ws].localDescription
                                            }
                                        }));
                                    }, server.log_error);
                                }, server.log_error);
                            }
                        }, server.log_error);
                    }

                    if(data.type == "ice_candidate") {
                        server.rtc_peer_conns[ws].addIceCandidate(new RTCIceCandidate(data.message.candidate));
                    }
                }
            });
        });
    },

    parse_client_message: function(ws, msg)
    {
        try {
            var data = JSON.parse(msg);
        } catch(e) {
            server.data_channels[ws].send(JSON.stringify({'type': 'err', 'msg': 'bad_json'}));
            return;
        }

        if(typeof data.type === 'undefined') {
            server.data_channels[ws].send(JSON.stringify({'type': 'err', 'msg': 'type_not_defined'}));
            return;
        }

        switch(data.type) {
            case 'hello':   handle_hello(ws, data);   break;
            case 'control': handle_control(ws, data); break;
            case 'ping':    handle_ping(ws, data);    break;
            default:
                server.send_data(ws, {'type': 'err', 'msg': 'type_not_found'});
                break;
        }
    },

    send_data: function(ws, data)
    {
       server.data_channels[ws].send(JSON.stringify(data));
    },

    broadcast: function(data)
    {
        for(var i=0; i<server.ws_con_list.length; ++i) {
            var ws = server.ws_con_list[i];
            server.data_channels[ws].send(JSON.stringify(data));
        }
    },

    step: function()
    {
        // ninjas updates sent every iteration
        var ninja_data = [];
        for(var i in game.ninjas) {
            ninja_data.push({
                'id': game.ninjas[i].id,
                'x':  game.ninjas[i].body.GetPosition().get_x(),
                'y':  game.ninjas[i].body.GetPosition().get_y(),
                'px': game.ninjas[i].body.GetLinearVelocity().get_x(),
                'py': game.ninjas[i].body.GetLinearVelocity().get_y(),
            });
        }

        // crate updates sent every 30 iterations
        var crate_data = [];
        if(game.iteration % 30 == 0) {
            for(var i in game.crates) {
                crate_data.push({
                    'id': game.crates[i].id,
                    'x':  game.crates[i].body.GetPosition().get_x(),
                    'y':  game.crates[i].body.GetPosition().get_y(),
                    'px': game.crates[i].body.GetLinearVelocity().get_x(),
                    'py': game.crates[i].body.GetLinearVelocity().get_y(),
                });
            }
        }


        var bullet_data = [];
        for(var i=0; i<game.send_buffer.length; ++i) {
            if(game.send_buffer[i].type == "bullet") {
                console.log("send bullet");
                var m = game.bullets[game.send_buffer[i].id];

                bullet_data.push({
                    "id":       m.id,
                    'x':        m.body.GetPosition().get_x(),
                    'y':        m.body.GetPosition().get_y(),
                    'px':       m.body.GetLinearVelocity().get_x(),
                    'py':       m.body.GetLinearVelocity().get_y(),
                    "gun_type": m.gun_type,
                });
            }
        }


        game.send_buffer = [];
        server.broadcast({
            "type":      "step",
            "iteration": game.iteration,
            "ninjas":    ninja_data,
            "crates":    crate_data,
            "bullets":   bullet_data,
        });
    }
};
server.init();



/**********************************
 *
 * SERVER LISTENERS
 *
 *********************************/

function handle_hello(ws, data)
{
    if(config.verbose) {
        console.log("handle_hello");
    }

    if(typeof server.users[ws] !== 'undefined') {
        server.send_data(ws, {'type': 'err', 'msg': 'already_hellod'});

        if(config.verbose) {
            console.log('user already hellod');
        }
    }

    var ninja_id = game.create_ninja();
    var s = game.random_spawn_point();
    game.ninjas[ninja_id].spawn(s.x, s.y);
    server.users[ws] = ninja_id;


    var asteroid_data = [];
    for(var i in game.asteroids) {
        asteroid_data.push({
            'id':     game.asteroids[i].id,
            'x':      game.asteroids[i].body.GetPosition().get_x(),
            'y':      game.asteroids[i].body.GetPosition().get_y(),
            'size':   game.asteroids[i].size,
            'edges':  game.asteroids[i].edges,
            'xtoy':   game.asteroids[i].xtoy,
            'ytox':   game.asteroids[i].ytox,
        });
    }

    var ninja_data = [];
    for(var i in game.ninjas) {
        ninja_data.push({
            'id':         game.ninjas[i].id,
            'x':          game.ninjas[i].body.GetPosition().get_x(),
            'y':          game.ninjas[i].body.GetPosition().get_y(),
            'alive':      game.ninjas[i].alive,
            'ninja_type': game.ninjas[i].ninja_type,
            'stock':      game.ninjas[i].stock,
            'deaths':     game.ninjas[i].deaths,
            'name':       game.ninjas[i].name,
            'gun': {
                'type': game.ninjas[i].gun.type,
                'ammo': game.ninjas[i].gun.ammo,
            },
            'jetpack': {
                'ammo': game.ninjas[i].jetpack.ammo
            }
        });
    }

    var crate_data = [];
    for(var i in game.crates) {
        crate_data.push({
            'id':         game.crates[i].id,
            'type':       game.crates[i].type,
            'x':          game.crates[i].body.GetPosition().get_x(),
            'y':          game.crates[i].body.GetPosition().get_y(),
            'px':         game.crates[i].body.GetLinearVelocity().get_x(),
            'py':         game.crates[i].body.GetLinearVelocity().get_y(),
            'angle':      game.crates[i].body.GetAngle(),
        });
    }

    var spawnpoint_data = [];
    for(var i in game.spawnpoints) {
        spawnpoint_data.push({
            'id': game.spawnpoints[i].id,
            'x':  game.spawnpoints[i].x,
            'y':  game.spawnpoints[i].y,
        });
    }

    server.send_data(ws, {
        'type': 'hello',
        'boundary':    game.boundary,
        'iteration':   game.iteration,
        'asteroids':   asteroid_data,
        'ninjas':      ninja_data,
        'ninja_id':    ninja_id,
        'crates':      crate_data,
        'spawnpoints': spawnpoint_data,
    });
}

function handle_control(ws, data)
{
    if(config.verbose) {
        console.log("handle_control");
    }

    var ninja_id = server.users[ws];

    // if this is older packet just ignore
    if(data.iteration >= game.ninjas[ninja_id].input.update_iteration) {
        game.ninjas[ninja_id].input.update_iteration = data.iteration;
        game.ninjas[ninja_id].input.mouse_down       = data.mouse_down;
        game.ninjas[ninja_id].input.key_result       = data.key_result;
        game.ninjas[ninja_id].input.mouse_angle      = data.mouse_angle;
    }
}

function handle_ping(ws, data)
{
    if(config.verbose) {
        console.log("handle_ping");
    }

    server.send_data(ws, {"type": "pong"});
}


/**********************************
 *
 * INITIALIZE GAME
 *
 *********************************/
game.init();
setInterval(function() {
    game.step();
    server.step();
}, 1000.0 / 60);


module.exports = server;
