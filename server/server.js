#!/usr/bin/env node


const webrtc  = require('wrtc');
const config  = require('./config');
const WebSocket = require('ws');

var RTCPeerConnection     = webrtc.RTCPeerConnection;
var RTCSessionDescription = webrtc.RTCSessionDescription;
var RTCIceCandidate       = webrtc.RTCIceCandidate;


var wss = new WebSocket.Server({ port: config.port });
console.log('smugrubber realtime server started on 127.0.0.1:' + config.port);

var rtc_peer_conns = {};
var data_channels = {};


wss.on('connection', function connection(ws) {
    // convenience function for ws
    function log_error(e)
    {
        console.log(e);
    }

    function receive_data_channel_message(ws, event)
    {
        if(config.verbose) {
            console.log('receive_data_channel_message: ' + event.data);
        }

        data_channels[ws].send('weeeee');
    }


    // SETUP NEW CONNECTION AND NEW DATA CHANNEL
    rtc_peer_conns[ws] = new RTCPeerConnection(config.rtc_peer_connection_options, null);

    rtc_peer_conns[ws].ondatachannel = function(event) {
        if(config.verbose) {
            console.log('receive_data_channel');
        }

        data_channels[ws] = event.channel;
        data_channels[ws].onmessage = function(event) {
            receive_data_channel_message(ws, event);
        };
    };

    data_channels[ws] = rtc_peer_conns[ws].createDataChannel('textMessages', config.data_channel_options);
    data_channels[ws].onopen = function() {
        if(config.verbose) {
            console.log('data_channel_state_changed: ' + this.readyState);
        }

        if(this.readyState === 'open') {
            this.onmessage = function(event) {
                receive_data_channel_message(ws, event);
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
                rtc_peer_conns[ws].setRemoteDescription(new RTCSessionDescription(data.message.sdp), function () {
                    // if we received an offer, we need to answer
                    if(rtc_peer_conns[ws].remoteDescription.type == 'offer') {
                        rtc_peer_conns[ws].createAnswer(function(desc) {
                            rtc_peer_conns[ws].setLocalDescription(desc, function () {
                                ws.send(JSON.stringify({
                                    "emit":"signal",
                                    "type":"SDP",
                                    "message": {
                                        'sdp': rtc_peer_conns[ws].localDescription
                                    }
                                }));
                            }, log_error);
                        }, log_error);
                    }
                }, log_error);
            }

            if(data.type == "ice_candidate") {
                rtc_peer_conns[ws].addIceCandidate(new RTCIceCandidate(data.message.candidate));
            }
        }
    });
});

