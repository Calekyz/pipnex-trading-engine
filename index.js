const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
require('dotenv').config();

const { BrokerFactory } = require('./brokers');
const { ZillionaireEA } = require('./strategies/zillionaire');
const { logger } = require('./utils/logger');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================
// In-Memory Store
// ============================================

const eaInstances = new Map(); // clientId -> { ea, broker, status, lastHeartbeat }

// ============================================
// API Endpoints
// ============================================

// Health Check
app.get('/health', (req, res) => {
    res.json({
        status: 'online',
        instances: eaInstances.size,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    });
});

// Get all running instances
app.get('/api/instances', (req, res) => {
    const instances = Array.from(eaInstances.entries()).map(([clientId, data]) => ({
        clientId,
        status: data.status,
        lastHeartbeat: data.lastHeartbeat,
        eaStatus: data.ea?.getStatus() || null,
        broker: data.broker,
    }));
    res.json({ instances });
});

// Start a new EA instance
app.post('/api/instance/start', async (req, res) => {
    try {
        const { 
            clientId, 
            broker, 
            accountId, 
            password, 
            server, 
            symbol, 
            config 
        } = req.body;

        if (!clientId || !broker || !accountId || !password) {
            return res.status(400).json({ 
                error: 'clientId, broker, accountId, and password are required' 
            });
        }

        // Check if already running
        if (eaInstances.has(clientId)) {
            return res.status(400).json({ 
                error: 'Instance already running for this client' 
            });
        }

        // Create broker adapter
        const brokerConfig = {
            accountId,
            password,
            server: server || 'Demo',
            apiUrl: process.env[`${broker.toUpperCase()}_API_URL`],
        };

        const brokerAdapter = BrokerFactory.create(broker, brokerConfig);
        await brokerAdapter.login();

        // Test connection
        const balance = await brokerAdapter.getBalance();
        if (!balance) {
            return res.status(401).json({ error: 'Failed to authenticate with broker' });
        }

        // Create EA instance
        const ea = new ZillionaireEA({
            clientId,
            broker,
            symbol: symbol || 'EUR/USD',
            ...config,
        });

        // Start EA
        ea.start();

        // Store instance
        eaInstances.set(clientId, {
            ea,
            broker: brokerAdapter,
            status: 'RUNNING',
            lastHeartbeat: Date.now(),
            startedAt: new Date(),
            accountId,
            balance,
        });

        logger.info(`✅ EA started for client: ${clientId} on ${broker}`);

        res.json({
            success: true,
            message: `Zillionaire EA started for ${clientId}`,
            balance,
            status: ea.getStatus(),
        });

    } catch (error) {
        logger.error('Start EA error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to start EA' 
        });
    }
});

// Stop an EA instance
app.post('/api/instance/stop', async (req, res) => {
    try {
        const { clientId } = req.body;

        if (!clientId) {
            return res.status(400).json({ error: 'clientId is required' });
        }

        const instance = eaInstances.get(clientId);
        if (!instance) {
            return res.status(404).json({ error: 'Instance not found' });
        }

        // Stop EA
        instance.ea.stop();
        instance.status = 'STOPPED';

        // Close all positions
        const positions = await instance.broker.getPositions();
        for (const position of positions) {
            if (position.symbol === instance.ea.symbol) {
                await instance.broker.closePosition(position.id || position.positionId);
            }
        }

        eaInstances.set(clientId, { ...instance, status: 'STOPPED' });

        logger.info(`⛔ EA stopped for client: ${clientId}`);

        res.json({
            success: true,
            message: `Zillionaire EA stopped for ${clientId}`,
        });

    } catch (error) {
        logger.error('Stop EA error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to stop EA' 
        });
    }
});

// Get EA status
app.get('/api/instance/:clientId/status', async (req, res) => {
    try {
        const { clientId } = req.params;
        const instance = eaInstances.get(clientId);

        if (!instance) {
            return res.status(404).json({ error: 'Instance not found' });
        }

        const balance = await instance.broker.getBalance();
        const positions = await instance.broker.getPositions();

        res.json({
            clientId,
            status: instance.status,
            eaStatus: instance.ea.getStatus(),
            balance,
            positions: positions?.length || 0,
            lastHeartbeat: instance.lastHeartbeat,
        });

    } catch (error) {
        logger.error('Status error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to get status' 
        });
    }
});

// Update EA configuration
app.post('/api/instance/:clientId/config', async (req, res) => {
    try {
        const { clientId } = req.params;
        const instance = eaInstances.get(clientId);

        if (!instance) {
            return res.status(404).json({ error: 'Instance not found' });
        }

        instance.ea.updateConfig(req.body);
        eaInstances.set(clientId, instance);

        res.json({
            success: true,
            message: 'Configuration updated',
        });

    } catch (error) {
        logger.error('Config update error:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to update config' 
        });
    }
});

// ============================================
// Background Tasks
// ============================================

// Run EA tick every 5 seconds
setInterval(async () => {
    for (const [clientId, instance] of eaInstances) {
        if (instance.status !== 'RUNNING') continue;

        try {
            const { ea, broker } = instance;
            await ea.onTick(null, broker);
            instance.lastHeartbeat = Date.now();
        } catch (error) {
            logger.error(`Tick error for ${clientId}:`, error.message);
        }
    }
}, 5000);

// Send heartbeat to platform every 30 seconds
setInterval(async () => {
    const platformUrl = process.env.PLATFORM_URL;
    const apiKey = process.env.PLATFORM_API_KEY;

    if (!platformUrl) return;

    const instances = Array.from(eaInstances.entries()).map(([clientId, data]) => ({
        clientId,
        status: data.status,
        eaStatus: data.ea?.getStatus() || null,
        balance: data.balance,
    }));

    try {
        await axios.post(`${platformUrl}/api/engine/heartbeat`, {
            instances,
            engineStatus: 'online',
            timestamp: new Date().toISOString(),
        }, {
            headers: { 'X-API-Key': apiKey || 'default' }
        });
    } catch (error) {
        logger.error('Heartbeat error:', error.message);
    }
}, 30000);

// ============================================
// Start Server
// ============================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.info(`🚀 PipnexAi Trading Engine running on port ${PORT}`);
    logger.info(`📡 Health: http://localhost:${PORT}/health`);
    logger.info(`📡 Instances: http://localhost:${PORT}/api/instances`);
    logger.info(`\n📊 Supported Brokers: IC_MARKETS, VALETAX, EXNESS, JUST_MARKET, HFM, FXPRO, PEPPERSTONE`);
});
