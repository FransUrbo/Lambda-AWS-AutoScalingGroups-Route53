'use strict';

var redis = require('redis');

exports.handler = function (event, context) {
    var endpoint = event.EndPoint;
    var group = event.Group;

    console.log("Endpoint: '"+ endpoint + "', Group: '" + group + "'");

    console.log("Connecting to Redis at '" + endpoint + "'");
    var client = new redis.createClient(endpoint, {
        socket_keepalive: false,
        enable_offline_queue: false,
        connect_timeout: 2000,
        retry_strategy: function (options) {
            if (options.error.code === 'ECONNREFUSED')
                return new Error('The server refused the connection');
            if (options.total_retry_time > 1000 * 2)
                return new Error('Retry time exhausted');
            if (options.times_connected > 5)
                return undefined;
            return Math.min(options.attempt * 50, 100);
        }
    });

    client.on("error", function (err) {
        console.error("Error " + err);
        context.done(err);
    });

    client.on('end', function() {
        console.log('Connection closed.');
    });

    client.on('ready', function () {
        console.log("Connected to Redis.");

        console.log("Existing keys:");
        client.keys(group ? group + ':*' : '*', function (err, keys) {
            if (err) return console.log(err);

            if (keys.length < 1) {
                console.log("No existing keys.");
            }
            else {
                console.log(JSON.stringify(keys, null, 2));

                var listPromise = new Promise(function(resolve, reject) {
                    client.lrange(group + ":list", 0, -1, function (err, replies) {
                        if (err) {
                            console.log("list error: " + err);
                            reject(err);
                        }
                        console.log("list: " + replies);
                        resolve();
                    });
                });

                var mapPromise = new Promise(function(resolve, reject) {
                    client.hgetall(group + ":map", function (err, replies) {
                        if (err) {
                            console.log("map error: " + err);
                            reject(err);
                        }
                        console.log("map: ", replies);
                        resolve();
                    });
                });

                var counterPromise = new Promise(function(resolve, reject) {
                    client.get(group + ":counter", function (err, replies) {
                        if (err) {
                            console.log("counter error: " + err);
                            reject(err);
                        }
                        console.log("counter: " + replies);
                        resolve();
                    });
                });
            }
            Promise.all([listPromise, mapPromise, counterPromise]).then(function() {
                context.done(err);
            });
        });
    });
};
