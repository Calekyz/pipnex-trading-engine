const axios = require('axios');
const { BrokerAdapter } = require('./base');

class JustMarketAdapter extends BrokerAdapter {
    constructor(config) {
        super(config);
        this.apiUrl = config.apiUrl || process.env.JUSTMARKET_API_URL || 'https://api.justmarket.com';
        this.accessToken = null;
    }

    async login() {
        try {
            const response = await axios.post(`${this.apiUrl}/v1/auth`, {
                accountId: this.accountId,
                password: this.password,
                server: this.server || 'JustMarket-Demo',
            });
            this.accessToken = response.data.token;
            this.loggedIn = true;
            console.log(`✅ Just Market: Logged in successfully (Account: ${this.accountId})`);
            return true;
        } catch (error) {
            console.error('Just Market login error:', error.response?.data || error.message);
            this.loggedIn = false;
            return false;
        }
    }

    async ensureLoggedIn() {
        if (!this.loggedIn) {
            await this.login();
        }
        return this.loggedIn;
    }

    async getBalance() {
        if (!await this.ensureLoggedIn()) return null;
        try {
            const response = await axios.get(`${this.apiUrl}/v1/account/balance`, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });
            return {
                balance: response.data.balance,
                equity: response.data.equity,
                freeMargin: response.data.freeMargin,
                margin: response.data.margin,
            };
        } catch (error) {
            console.error('Just Market balance error:', error.response?.data || error.message);
            return null;
        }
    }

    async getQuote(symbol) {
        if (!await this.ensureLoggedIn()) return null;
        try {
            const response = await axios.get(`${this.apiUrl}/v1/quote/${symbol}`, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });
            return {
                symbol: symbol,
                bid: response.data.bid,
                ask: response.data.ask,
                high: response.data.high,
                low: response.data.low,
            };
        } catch (error) {
            console.error('Just Market quote error:', error.response?.data || error.message);
            return null;
        }
    }

    async placeOrder(symbol, direction, volume, stopLoss, takeProfit) {
        if (!await this.ensureLoggedIn()) return null;
        try {
            const order = {
                symbol: symbol,
                side: direction === 'BUY' ? 'BUY' : 'SELL',
                volume: this.validateLot(volume),
                type: 'MARKET',
            };
            if (stopLoss) order.stopLoss = stopLoss;
            if (takeProfit) order.takeProfit = takeProfit;

            const response = await axios.post(`${this.apiUrl}/v1/order`, order, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });
            return {
                success: true,
                orderId: response.data.orderId,
                price: response.data.price,
                message: 'Order placed successfully',
            };
        } catch (error) {
            console.error('Just Market order error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || 'Order failed',
            };
        }
    }

    async getPositions() {
        if (!await this.ensureLoggedIn()) return null;
        try {
            const response = await axios.get(`${this.apiUrl}/v1/positions`, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });
            return response.data.positions || [];
        } catch (error) {
            console.error('Just Market positions error:', error.response?.data || error.message);
            return [];
        }
    }

    async closePosition(positionId) {
        if (!await this.ensureLoggedIn()) return null;
        try {
            const response = await axios.delete(`${this.apiUrl}/v1/positions/${positionId}`, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });
            return {
                success: true,
                message: 'Position closed successfully',
            };
        } catch (error) {
            console.error('Just Market close error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || 'Close failed',
            };
        }
    }

    async modifyStopLoss(positionId, stopLoss) {
        if (!await this.ensureLoggedIn()) return null;
        try {
            const response = await axios.put(
                `${this.apiUrl}/v1/positions/${positionId}/stop-loss`,
                { stopLoss },
                { headers: { 'Authorization': `Bearer ${this.accessToken}` } }
            );
            return {
                success: true,
                message: 'Stop loss updated',
            };
        } catch (error) {
            console.error('Just Market modify SL error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || 'Modify SL failed',
            };
        }
    }

    async getOpenOrders() {
        if (!await this.ensureLoggedIn()) return null;
        try {
            const response = await axios.get(`${this.apiUrl}/v1/orders`, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });
            return response.data.orders || [];
        } catch (error) {
            console.error('Just Market orders error:', error.response?.data || error.message);
            return [];
        }
    }
}

module.exports = { JustMarketAdapter };
