/**
 * Base Broker Adapter
 * All broker adapters extend this class
 */
class BrokerAdapter {
    constructor(config) {
        this.accountId = config.accountId;
        this.password = config.password;
        this.server = config.server;
        this.apiUrl = config.apiUrl;
        this.apiKey = config.apiKey;
        this.loggedIn = false;
    }

    async login() {
        throw new Error('login() must be implemented by broker adapter');
    }

    async getBalance() {
        throw new Error('getBalance() must be implemented by broker adapter');
    }

    async getQuote(symbol) {
        throw new Error('getQuote() must be implemented by broker adapter');
    }

    async placeOrder(symbol, direction, volume, stopLoss, takeProfit) {
        throw new Error('placeOrder() must be implemented by broker adapter');
    }

    async getPositions() {
        throw new Error('getPositions() must be implemented by broker adapter');
    }

    async closePosition(positionId) {
        throw new Error('closePosition() must be implemented by broker adapter');
    }

    async getOpenOrders() {
        throw new Error('getOpenOrders() must be implemented by broker adapter');
    }

    async modifyStopLoss(positionId, stopLoss) {
        throw new Error('modifyStopLoss() must be implemented by broker adapter');
    }

    formatPrice(symbol, price) {
        const isJPY = symbol.includes('JPY');
        const isMetal = symbol.includes('XAU') || symbol.includes('XAG');
        const decimals = isMetal ? 2 : isJPY ? 3 : 5;
        return Number(price).toFixed(decimals);
    }

    getPipSize(symbol) {
        const isJPY = symbol.includes('JPY');
        const isMetal = symbol.includes('XAU') || symbol.includes('XAG');
        if (isMetal) return 0.01;
        if (isJPY) return 0.01;
        return 0.0001;
    }

    calculatePips(symbol, entry, exit) {
        const diff = Math.abs(entry - exit);
        const pipSize = this.getPipSize(symbol);
        return Math.round(diff / pipSize);
    }

    validateLot(lot, minLot = 0.01, maxLot = 100, step = 0.01) {
        let adjusted = Math.max(minLot, Math.min(maxLot, lot));
        adjusted = Math.round(adjusted / step) * step;
        return adjusted;
    }

    validateStopLoss(symbol, price, stopLoss, isBuy) {
        const minDistance = 10 * this.getPipSize(symbol);
        const diff = Math.abs(price - stopLoss);
        if (diff < minDistance) {
            return isBuy ? price - minDistance : price + minDistance;
        }
        return stopLoss;
    }
}

module.exports = { BrokerAdapter };
