/**
 * Zillionaire EA - Node.js Version
 * Full Martingale Strategy with Sequence Trading
 */
class ZillionaireEA {
    constructor(config) {
        this.initialLot = config.initialLot || 0.05;
        this.martingaleMultiplier = config.martingaleMultiplier || 2.0;
        this.maxMartingaleLevels = config.maxMartingaleLevels || 3;
        this.recoveryTarget = config.recoveryTarget || 20.0;
        this.initialSL = config.initialSL || 70.0;
        this.tradesPerSequence = config.tradesPerSequence || 3;
        this.maxConcurrentPositions = config.maxConcurrentPositions || 10;
        this.secondsBetweenTrades = config.secondsBetweenTrades || 3;
        this.magicNumber = config.magicNumber || 7049;
        this.tradeBuy = config.tradeBuy !== false;
        this.tradeSell = config.tradeSell !== false;
        this.alternateDirection = config.alternateDirection !== false;
        this.sameDirectionPerSequence = config.sameDirectionPerSequence !== false;
        this.useTrailingStop = config.useTrailingStop !== false;
        this.trailingStart = config.trailingStart || 20.0;
        this.trailingDistance = config.trailingDistance || 3.0;
        this.useTimeFilter = config.useTimeFilter || false;
        this.startHour = config.startHour || 8;
        this.endHour = config.endHour || 20;
        this.maxDailyLoss = config.maxDailyLoss || 0;
        this.maxDrawdownPercent = config.maxDrawdownPercent || 25.0;

        this.symbol = config.symbol || 'EUR/USD';
        this.clientId = config.clientId;
        this.broker = config.broker;

        // Trading state
        this.totalTradesExecuted = 0;
        this.winningTrades = 0;
        this.losingTrades = 0;
        this.consecutiveLosses = 0;
        this.currentMartingaleLevel = 1;
        this.currentLotSize = this.initialLot;
        this.totalRecoveryPips = 0;
        this.lastTradeTime = null;
        this.currentDay = null;
        this.startingBalance = 0;
        this.dailyStartingBalance = 0;
        this.dailyLoss = 0;
        this.tradingEnabled = true;
        this.lastDirection = 0;
        this.sequenceDirection = 0;
        this.inRecoveryMode = false;
        this.tradesSinceLastReset = 0;
        this.tradesInCurrentSequence = 0;
        this.sequencesCompleted = 0;
        this.openPositions = [];
        this.positionMap = {};
    }

    async onTick(marketData, brokerAdapter) {
        if (!this.tradingEnabled) return;

        if (!this.isTradingHours()) return;
        this.checkDailyReset();

        if (this.maxDailyLoss > 0 && this.dailyLoss >= this.maxDailyLoss) {
            this.tradingEnabled = false;
            console.log('⚠️ Zillionaire EA: Daily loss limit reached');
            return;
        }

        if (await this.checkDrawdown(brokerAdapter)) {
            this.tradingEnabled = false;
            console.log('⚠️ Zillionaire EA: Max drawdown reached');
            return;
        }

        await this.manageAllPositions(brokerAdapter);

        if (this.tradesInCurrentSequence >= this.tradesPerSequence) {
            this.completeSequence();
        }

        this.checkRecoveryModeTrigger();

        if (this.lastTradeTime) {
            const elapsed = (Date.now() - this.lastTradeTime) / 1000;
            if (elapsed < this.secondsBetweenTrades) return;
        }

        if (this.openPositions.length >= this.maxConcurrentPositions) return;

        if (this.tradesInCurrentSequence < this.tradesPerSequence) {
            const signal = this.getTradingSignal();
            if (signal === 1 && this.tradeBuy) {
                await this.executeBuy(marketData, brokerAdapter);
            } else if (signal === -1 && this.tradeSell) {
                await this.executeSell(marketData, brokerAdapter);
            }
        }
    }

    getTradingSignal() {
        if (!this.tradeBuy && !this.tradeSell) return 0;

        if (this.sameDirectionPerSequence && this.sequenceDirection !== 0) {
            if (this.sequenceDirection === 1 && this.tradeBuy) return 1;
            if (this.sequenceDirection === -1 && this.tradeSell) return -1;
            return 0;
        }

        if (this.alternateDirection) {
            if (this.lastDirection === 0) {
                if (this.tradeBuy && this.tradeSell) {
                    this.lastDirection = 1;
                    return 1;
                } else if (this.tradeBuy) return 1;
                else if (this.tradeSell) return -1;
            } else if (this.lastDirection === 1 && this.tradeSell) {
                this.lastDirection = -1;
                return -1;
            } else if (this.lastDirection === -1 && this.tradeBuy) {
                this.lastDirection = 1;
                return 1;
            }
        }
        return this.tradeBuy ? 1 : -1;
    }

    async executeBuy(marketData, brokerAdapter) {
        const tradeNum = this.tradesInCurrentSequence + 1;
        let lots = this.initialLot;
        let level = 1;

        if (tradeNum === 1) { lots = this.initialLot; level = 1; }
        else if (tradeNum === 2) { lots = this.initialLot * this.martingaleMultiplier; level = 2; }
        else if (tradeNum === 3) { lots = this.initialLot * this.martingaleMultiplier * this.martingaleMultiplier; level = 3; }
        else {
            lots = this.initialLot;
            for (let i = 1; i < tradeNum && i <= this.maxMartingaleLevels; i++) {
                lots *= this.martingaleMultiplier;
            }
            level = (tradeNum > this.maxMartingaleLevels) ? this.maxMartingaleLevels : tradeNum;
        }

        if (this.inRecoveryMode && this.currentMartingaleLevel > 1) {
            lots = this.initialLot;
            for (let i = 1; i < this.currentMartingaleLevel; i++) {
                lots *= this.martingaleMultiplier;
            }
        }

        lots = brokerAdapter.validateLot(lots);
        this.currentLotSize = lots;

        const quote = await brokerAdapter.getQuote(this.symbol);
        if (!quote) {
            console.error('❌ Zillionaire EA: Failed to get quote for BUY');
            return;
        }

        const ask = quote.ask;
        const point = brokerAdapter.getPipSize(this.symbol);
        const slPrice = ask - (this.initialSL * point * 10);
        const tpPrice = ask + (this.recoveryTarget * point * 10);

        const result = await brokerAdapter.placeOrder(this.symbol, 'BUY', lots, slPrice, tpPrice);

        if (result && result.success) {
            this.totalTradesExecuted++;
            this.tradesInCurrentSequence++;
            this.tradesSinceLastReset++;
            this.lastTradeTime = Date.now();

            if (this.sameDirectionPerSequence && this.tradesInCurrentSequence === 1) {
                this.sequenceDirection = 1;
            }

            console.log(`✅ Zillionaire EA BUY - Seq ${this.sequencesCompleted + 1}, Trade ${tradeNum}/${this.tradesPerSequence}`);
            console.log(`   Entry: ${result.price}, SL: ${slPrice}, TP: ${tpPrice}`);

            if (result.orderId) {
                this.positionMap[result.orderId] = {
                    ticket: result.orderId,
                    type: 'BUY',
                    openPrice: result.price,
                    stopLoss: slPrice,
                    takeProfit: tpPrice,
                    volume: lots,
                    openTime: Date.now(),
                };
                this.openPositions.push(result.orderId);
            }
        } else {
            console.log(`❌ Zillionaire EA BUY FAILED:`, result?.error || 'Unknown error');
        }
    }

    async executeSell(marketData, brokerAdapter) {
        const tradeNum = this.tradesInCurrentSequence + 1;
        let lots = this.initialLot;
        let level = 1;

        if (tradeNum === 1) { lots = this.initialLot; level = 1; }
        else if (tradeNum === 2) { lots = this.initialLot * this.martingaleMultiplier; level = 2; }
        else if (tradeNum === 3) { lots = this.initialLot * this.martingaleMultiplier * this.martingaleMultiplier; level = 3; }
        else {
            lots = this.initialLot;
            for (let i = 1; i < tradeNum && i <= this.maxMartingaleLevels; i++) {
                lots *= this.martingaleMultiplier;
            }
            level = (tradeNum > this.maxMartingaleLevels) ? this.maxMartingaleLevels : tradeNum;
        }

        if (this.inRecoveryMode && this.currentMartingaleLevel > 1) {
            lots = this.initialLot;
            for (let i = 1; i < this.currentMartingaleLevel; i++) {
                lots *= this.martingaleMultiplier;
            }
        }

        lots = brokerAdapter.validateLot(lots);
        this.currentLotSize = lots;

        const quote = await brokerAdapter.getQuote(this.symbol);
        if (!quote) {
            console.error('❌ Zillionaire EA: Failed to get quote for SELL');
            return;
        }

        const bid = quote.bid;
        const point = brokerAdapter.getPipSize(this.symbol);
        const slPrice = bid + (this.initialSL * point * 10);
        const tpPrice = bid - (this.recoveryTarget * point * 10);

        const result = await brokerAdapter.placeOrder(this.symbol, 'SELL', lots, slPrice, tpPrice);

        if (result && result.success) {
            this.totalTradesExecuted++;
            this.tradesInCurrentSequence++;
            this.tradesSinceLastReset++;
            this.lastTradeTime = Date.now();

            if (this.sameDirectionPerSequence && this.tradesInCurrentSequence === 1) {
                this.sequenceDirection = -1;
            }

            console.log(`✅ Zillionaire EA SELL - Seq ${this.sequencesCompleted + 1}, Trade ${tradeNum}/${this.tradesPerSequence}`);
            console.log(`   Entry: ${result.price}, SL: ${slPrice}, TP: ${tpPrice}`);

            if (result.orderId) {
                this.positionMap[result.orderId] = {
                    ticket: result.orderId,
                    type: 'SELL',
                    openPrice: result.price,
                    stopLoss: slPrice,
                    takeProfit: tpPrice,
                    volume: lots,
                    openTime: Date.now(),
                };
                this.openPositions.push(result.orderId);
            }
        } else {
            console.log(`❌ Zillionaire EA SELL FAILED:`, result?.error || 'Unknown error');
        }
    }

    async manageAllPositions(brokerAdapter) {
        const positions = await brokerAdapter.getPositions();
        if (!positions || positions.length === 0) {
            this.openPositions = [];
            return;
        }

        const filteredPositions = positions.filter(p => p.symbol === this.symbol);
        this.openPositions = filteredPositions.map(p => p.id || p.positionId);

        for (const position of filteredPositions) {
            await this.manageSinglePosition(position, brokerAdapter);
        }
    }

    async manageSinglePosition(position, brokerAdapter) {
        const id = position.id || position.positionId;
        const isBuy = position.type === 'BUY';
        const openPrice = position.openPrice || position.price;
        const currentPrice = isBuy ? position.bid : position.ask;
        const point = brokerAdapter.getPipSize(this.symbol);

        const profitPips = isBuy 
            ? (currentPrice - openPrice) / point 
            : (openPrice - currentPrice) / point;

        if (this.useTrailingStop && profitPips >= this.trailingStart) {
            const newSL = isBuy 
                ? currentPrice - (this.trailingDistance * point)
                : currentPrice + (this.trailingDistance * point);

            const currentSL = position.stopLoss || 0;
            if ((isBuy && newSL > currentSL) || (!isBuy && newSL < currentSL) || currentSL === 0) {
                await brokerAdapter.modifyStopLoss(id, newSL);
                console.log(`🔷 Trailing Stop updated: ${this.symbol} -> ${newSL.toFixed(5)}`);
            }
        }

        if (profitPips >= this.recoveryTarget) {
            console.log(`✅ Zillionaire EA: Recovery target reached (${profitPips.toFixed(1)} pips)`);
            await brokerAdapter.closePosition(id);
            this.openPositions = this.openPositions.filter(p => p !== id);
        }
    }

    completeSequence() {
        this.sequencesCompleted++;
        this.tradesInCurrentSequence = 0;
        this.currentMartingaleLevel = 1;
        this.currentLotSize = this.initialLot;
        this.inRecoveryMode = false;
        this.consecutiveLosses = 0;
        this.tradesSinceLastReset = 0;
        this.sequenceDirection = 0;
        console.log(`✅ Zillionaire EA: SEQUENCE ${this.sequencesCompleted} COMPLETED!`);
    }

    checkRecoveryModeTrigger() {
        if (this.inRecoveryMode) return;

        let shouldTrigger = false;
        let triggerReason = '';

        if (this.tradesSinceLastReset >= 1 && this.tradesInCurrentSequence === 1) {
            shouldTrigger = true;
            triggerReason = 'Trade #1 completed';
        }

        if (this.consecutiveLosses >= 1) {
            shouldTrigger = true;
            triggerReason = `Loss on trade #${this.tradesInCurrentSequence}`;
        }

        if (shouldTrigger && !this.inRecoveryMode && 
            this.currentMartingaleLevel === 1 && 
            this.tradesInCurrentSequence < this.tradesPerSequence) {
            this.enterRecoveryMode(triggerReason);
        }
    }

    enterRecoveryMode(reason) {
        this.inRecoveryMode = true;
        this.currentMartingaleLevel = this.tradesInCurrentSequence + 1;

        let lotSize = this.initialLot;
        for (let i = 1; i < this.currentMartingaleLevel; i++) {
            lotSize *= this.martingaleMultiplier;
        }
        this.currentLotSize = lotSize;

        console.log(`🔴 Zillionaire EA: RECOVERY MODE ACTIVATED`);
        console.log(`   Trigger: ${reason}`);
        console.log(`   Martingale Level: ${this.currentMartingaleLevel}`);
        console.log(`   Recovery Lot: ${this.currentLotSize}`);
        console.log(`   Target: ${this.recoveryTarget} pips`);
    }

    checkDailyReset() {
        const today = new Date().toDateString();
        if (today !== this.currentDay) {
            this.currentDay = today;
            this.dailyLoss = 0;
            console.log(`📅 Zillionaire EA: New day - resetting counters`);
        }
    }

    async checkDrawdown(brokerAdapter) {
        const balance = await brokerAdapter.getBalance();
        if (!balance) return false;

        this.startingBalance = balance.balance || balance.equity || 10000;
        const currentEquity = balance.equity || balance.balance;
        const drawdownPercent = ((this.startingBalance - currentEquity) / this.startingBalance) * 100;

        if (drawdownPercent >= this.maxDrawdownPercent) {
            console.log(`⚠️ Zillionaire EA: Max drawdown: ${drawdownPercent.toFixed(1)}%`);
            return true;
        }
        return false;
    }

    isTradingHours() {
        if (!this.useTimeFilter) return true;
        const hour = new Date().getHours();
        return (hour >= this.startHour && hour < this.endHour);
    }

    getStatus() {
        return {
            sequencesCompleted: this.sequencesCompleted,
            totalTrades: this.totalTradesExecuted,
            winningTrades: this.winningTrades,
            losingTrades: this.losingTrades,
            inRecoveryMode: this.inRecoveryMode,
            currentSequence: this.sequencesCompleted + 1,
            tradesInSequence: this.tradesInCurrentSequence,
            tradesPerSequence: this.tradesPerSequence,
            currentLot: this.currentLotSize,
            isRunning: this.tradingEnabled,
            openPositions: this.openPositions.length,
        };
    }

    start() {
        this.tradingEnabled = true;
        console.log(`🟢 Zillionaire EA: STARTED`);
    }

    stop() {
        this.tradingEnabled = false;
        console.log(`🔴 Zillionaire EA: STOPPED`);
    }

    pause() {
        this.tradingEnabled = false;
        console.log(`⏸️ Zillionaire EA: PAUSED`);
    }

    resume() {
        this.tradingEnabled = true;
        console.log(`▶️ Zillionaire EA: RESUMED`);
    }

    updateConfig(config) {
        Object.assign(this, config);
        console.log(`⚙️ Zillionaire EA: Configuration updated`);
    }
}

module.exports = { ZillionaireEA };
