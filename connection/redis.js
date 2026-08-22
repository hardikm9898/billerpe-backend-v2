const redis = require('redis');
require("dotenv").config();

const redisClient = redis.createClient({
    socket: {
        host: process.env.REDIS_HOST || "redis-app.billerpe.com",
        port: parseInt(process.env.REDIS_PORT) || 6379,

        reconnectStrategy: (retries) => {
            console.log(`Redis reconnect attempt #${retries}`);

            // Always retry after 10 seconds
            return 10000;
        }
    },
    database: parseInt(process.env.REDIS_DB) || 0,
    password: process.env.REDIS_PASSWORD
});

redisClient.on('error', (err) => {
    console.error('Redis client error:', err.message);
});

redisClient.on('reconnecting', () => {
    console.log('Redis reconnecting...');
});

redisClient.on('connect', () => {
    console.log('Redis connected');
});

redisClient.on('ready', () => {
    console.log('Redis ready to use');
});

module.exports = redisClient;