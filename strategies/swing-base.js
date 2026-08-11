const { BaseStrategy } = require('./base');

/**
 * Base Swing Strategy Class
 * Used by Kairon Swing Master, Nova Edge AI, and Straddle AI
 */
class SwingStrategyBase extends BaseStrategy {
    constructor(config) {
        super(config);
        this.swingStrength = config.swingStrength || 30;
        this.lotSize = config.lotSize || 0.05;
        this.rewardRiskRatio = config.rewardRiskRatio || 3.0;
        this.maxOpenPositions = config.maxOpenPositions || 5;
        this.fibLevels = config.fibLevels || '0.236,0.382,0.5,0.618,0.786';
        this.buyFibLevels = config.buyFibLevels || [0.382, 0.618];
        this.sellFibLevels = config.sellFibLevels || [0.382, 0.618, 0.786];
        this.lastBarTime = null;
        this.lastAlertTime = null;
        this.previousHigh = 0;
        this.previousLow = 0;
        this.fibLevelsArray = [];
        this.tradeCount = 0;

        // Parse Fibonacci levels
        const levels = this.fibLevels.split(',').map(s => parseFloat(s.trim()));
        this.fibLevelsArray = levels;
    }

    parseFibLevels(fibString) {
        return fibString.split(',').map(s => parseFloat(s.trim()));
    }

    async onTick(marketData, brokerAdapter) {
        if (!this.tradingEnabled) return;

        // New bar detection
        const currentBarTime = Date.now();
        if (currentBarTime === this.lastBarTime) return;
        this.lastBarTime = currentBarTime;

        // Check trading hours
        if (!this.isTradingHours(this.useTimeFilter || false, this.startHour || 8, this.endHour || 20)) return;

        // Check daily reset
        this.checkDailyReset();

        // Check drawdown (if maxDrawdownPercent is set)
        if (this.maxDrawdownPercent && await this.checkDrawdown(brokerAdapter, this.maxDrawdownPercent)) {
            this.tradingEnabled = false;
            return;
        }

        // Get price data
        const quote = await brokerAdapter.getQuote(this.symbol);
        if (!quote) return;

        // Detect swing highs and lows (simplified for demo)
        // In production, you'd maintain a price history
        const price = parseFloat(quote.bid);
        const ask = parseFloat(quote.ask);

        // Example swing detection – you should replace with actual logic
        const recentSwingHigh = price * 1.005;
        const recentSwingLow = price * 0.995;
        const fibRange = recentSwingHigh - recentSwingLow;
        const currentClose = price;
        const prevClose = price * 0.999;

        // Count open positions
        const positions = await brokerAdapter.getPositions();
        const openPositions = positions ? positions.filter(p => p.symbol === this.symbol).length : 0;

        if (openPositions >= this.maxOpenPositions) return;

        // Buy signals
        for (const fibLevel of this.buyFibLevels) {
            const fibPrice = recentSwingHigh - fibRange * fibLevel;
            if (prevClose >= fibPrice && currentClose < fibPrice) {
                const slPrice = recentSwingLow;
                const entryPrice = ask;
                const risk = entryPrice - slPrice;
                const tpPrice = entryPrice + risk * this.rewardRiskRatio;

                if (slPrice > 0 && slPrice < entryPrice && tpPrice > entryPrice) {
                    const result = await brokerAdapter.placeOrder(
                        this.symbol,
                        'BUY',
                        this.lotSize,
                        slPrice,
                        tpPrice
                    );
                    if (result && result.success) {
                        console.log(`✅ BUY Signal: ${this.symbol} at ${this.formatPrice(entryPrice, this.symbol)}`);
                        this.totalTradesExecuted++;
                        this.openPositions.push(result.orderId);
                    }
                    break;
                }
            }
        }

        // Sell signals
        for (const fibLevel of this.sellFibLevels) {
            const fibPrice = recentSwingHigh - fibRange * fibLevel;
            if (prevClose <= fibPrice && currentClose > fibPrice) {
                const slPrice = recentSwingHigh;
                const entryPrice = price;
                const risk = slPrice - entryPrice;
                const tpPrice = entryPrice - risk * this.rewardRiskRatio;

                if (slPrice > entryPrice && tpPrice < entryPrice) {
                    const result = await brokerAdapter.placeOrder(
                        this.symbol,
                        'SELL',
                        this.lotSize,
                        slPrice,
                        tpPrice
                    );
                    if (result && result.success) {
                        console.log(`✅ SELL Signal: ${this.symbol} at ${this.formatPrice(entryPrice, this.symbol)}`);
                        this.totalTradesExecuted++;
                        this.openPositions.push(result.orderId);
                    }
                    break;
                }
            }
        }
    }

    getStatus() {
        return {
            ...super.getStatus(),
            swingStrength: this.swingStrength,
            fibLevels: this.fibLevels,
            lotSize: this.lotSize,
            rewardRiskRatio: this.rewardRiskRatio,
            maxOpenPositions: this.maxOpenPositions,
        };
    }
}

module.exports = { SwingStrategyBase };
