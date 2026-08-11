const axios = require('axios');
const { BrokerAdapter } = require('./base');

class ICMarketsAdapter extends BrokerAdapter {
    constructor(config) {
        super(config);
        this.apiUrl = config.apiUrl || 'https://mt5-api.icmarkets.com';
        this.accessToken = null;
        this.accountType = 'demo';
    }

    async login() {
        try {
            const response = await axios.post(`${this.apiUrl}/api/v1/auth/login`, {
                accountId: this.accountId,
                password: this.password,
                server: this.server,
            });
            this.accessToken = response.data.token;
            this.loggedIn = true;
            console.log(`✅ IC Markets: Logged in successfully (Account: ${this.accountId})`);
            return true;
        } catch (error) {
            console.error('IC Markets login error:', error.response?.data || error.message);
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
            const response = await axios.get(`${this.apiUrl}/api/v1/accounts/${this.accountId}`, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });
            return {
                balance: response.data.balance,
                equity: response.data.equity,
                freeMargin: response.data.freeMargin,
                margin: response.data.margin,
            };
        } catch (error) {
            console.error('IC Markets balance error:', error.response?.data || error.message);
            return null;
        }
    }

    async getQuote(symbol) {
        if (!await this.ensureLoggedIn()) return null;
        try {
            const response = await axios.get(`${this.apiUrl}/api/v1/quotes/${symbol}`, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });
            return {
                symbol: symbol,
                bid: response.data.bid,
                ask: response.data.ask,
                high: response.data.high,
                low: response.data.low,
                open: response.data.open,
                close: response.data.close,
            };
        } catch (error) {
            console.error('IC Markets quote error:', error.response?.data || error.message);
            return null;
        }
    }

    async placeOrder(symbol, direction, volume, stopLoss, takeProfit) {
        if (!await this.ensureLoggedIn()) return null;
        try {
            const order = {
                symbol: symbol,
                action: direction === 'BUY' ? 'buy' : 'sell',
                volume: this.validateLot(volume),
                type: 'market',
            };
            if (stopLoss) order.stopLoss = stopLoss;
            if (takeProfit) order.takeProfit = takeProfit;

            const response = await axios.post(`${this.apiUrl}/api/v1/orders`, order, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });
            return {
                success: true,
                orderId: response.data.orderId,
                price: response.data.price,
                message: 'Order placed successfully',
            };
        } catch (error) {
            console.error('IC Markets order error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || 'Order failed',
            };
        }
    }

    async getPositions() {
        if (!await this.ensureLoggedIn()) return null;
        try {
            const response = await axios.get(`${this.apiUrl}/api/v1/positions`, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });
            return response.data.positions || [];
        } catch (error) {
            console.error('IC Markets positions error:', error.response?.data || error.message);
            return [];
        }
    }

    async closePosition(positionId) {
        if (!await this.ensureLoggedIn()) return null;
        try {
            const response = await axios.delete(`${this.apiUrl}/api/v1/positions/${positionId}`, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });
            return {
                success: true,
                message: 'Position closed successfully',
            };
        } catch (error) {
            console.error('IC Markets close position error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || 'Close position failed',
            };
        }
    }

    async modifyStopLoss(positionId, stopLoss) {
        if (!await this.ensureLoggedIn()) return null;
        try {
            const response = await axios.put(
                `${this.apiUrl}/api/v1/positions/${positionId}/stop-loss`,
                { stopLoss },
                { headers: { 'Authorization': `Bearer ${this.accessToken}` } }
            );
            return {
                success: true,
                message: 'Stop loss updated',
            };
        } catch (error) {
            console.error('IC Markets modify SL error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.message || 'Modify SL failed',
            };
        }
    }

    async getOpenOrders() {
        if (!await this.ensureLoggedIn()) return null;
        try {
            const response = await axios.get(`${this.apiUrl}/api/v1/orders`, {
                headers: { 'Authorization': `Bearer ${this.accessToken}` }
            });
            return response.data.orders || [];
        } catch (error) {
            console.error('IC Markets orders error:', error.response?.data || error.message);
            return [];
        }
    }
}

module.exports = { ICMarketsAdapter };
