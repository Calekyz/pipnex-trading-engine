/**
 * Base Strategy Class
 * All EA strategies extend this class
 */
class BaseStrategy {
    constructor(config) {
        this.symbol = config.symbol || 'EUR/USD';
        this.clientId = config.clientId;
        this.broker = config.broker;
        this.tradingEnabled = true;
        this.totalTradesExecuted = 0;
        this.winningTrades = 0;
        this.losingTrades = 0;
        this.startingBalance = 0;
        this.lastTradeTime = null;
        this.currentDay = null;
        this.dailyLoss = 0;
        this.openPositions = [];
        this.positionMap = {};
    }

    // Must be implemented by each strategy
    async onTick(marketData, brokerAdapter) {
        throw new Error('onTick() must be implemented by strategy');
    }

    start() {
        this.tradingEnabled = true;
        console.log(`🟢 ${this.constructor.name}: STARTED`);
    }

    stop() {
        this.tradingEnabled = false;
        console.log(`🔴 ${this.constructor.name}: STOPPED`);
    }

    pause() {
        this.tradingEnabled = false;
        console.log(`⏸️ ${this.constructor.name}: PAUSED`);
    }

    resume() {
        this.tradingEnabled = true;
        console.log(`▶️ ${this.constructor.name}: RESUMED`);
    }

    getStatus() {
        return {
            totalTrades: this.totalTradesExecuted,
            winningTrades: this.winningTrades,
            losingTrades: this.losingTrades,
            isRunning: this.tradingEnabled,
            openPositions: this.openPositions.length,
        };
    }

    updateConfig(config) {
        Object.assign(this, config);
        console.log(`⚙️ ${this.constructor.name}: Configuration updated`);
    }

    checkDailyReset() {
        const today = new Date().toDateString();
        if (today !== this.currentDay) {
            this.currentDay = today;
            this.dailyLoss = 0;
            console.log(`📅 ${this.constructor.name}: New day - resetting counters`);
        }
    }

    async checkDrawdown(brokerAdapter, maxDrawdownPercent) {
        const balance = await brokerAdapter.getBalance();
        if (!balance) return false;

        this.startingBalance = balance.balance || balance.equity || 10000;
        const currentEquity = balance.equity || balance.balance;
        const drawdownPercent = ((this.startingBalance - currentEquity) / this.startingBalance) * 100;

        if (drawdownPercent >= maxDrawdownPercent) {
            console.log(`⚠️ ${this.constructor.name}: Max drawdown: ${drawdownPercent.toFixed(1)}%`);
            return true;
        }
        return false;
    }

    isTradingHours(useTimeFilter, startHour, endHour) {
        if (!useTimeFilter) return true;
        const hour = new Date().getHours();
        return (hour >= startHour && hour < endHour);
    }

    formatPrice(price, symbol) {
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
}

module.exports = { BaseStrategy };
