const { BaseStrategy } = require('./base');

/**
 * PipNex AI Strategy
 * Node.js version of the PipNex AI Martingale EA
 * Supports sequence trading, martingale lot sizing, recovery mode, grid averaging, trailing stop.
 */
class PipNexAIStrategy extends BaseStrategy {
    constructor(config) {
        super(config);

        // --- Martingale Settings ---
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
        this.startupDelaySeconds = config.startupDelaySeconds || 60;

        // --- Grid Averaging Settings ---
        this.useDrawdownGrid = config.useDrawdownGrid || false;
        this.drawdownStepPips = config.drawdownStepPips || 10;
        this.maxDrawdownAdditions = config.maxDrawdownAdditions || 3;
        this.gridLotMultiplier = config.gridLotMultiplier || 1.0;

        // --- State ---
        this.totalTradesExecuted = 0;
        this.winningTrades = 0;
        this.losingTrades = 0;
        this.consecutiveLosses = 0;
        this.currentMartingaleLevel = 1;
        this.currentLotSize = this.initialLot;
        this.totalRecoveryPips = 0;
        this.lastTradeTime = null;
        this.currentDay = null;
        this.dailyLoss = 0;
        this.startingBalance = 0;
        this.tradingEnabled = true;
        this.lastDirection = 0;
        this.sequenceDirection = 0;
        this.inRecoveryMode = false;
        this.tradesSinceLastReset = 0;
        this.tradesInCurrentSequence = 0;
        this.sequencesCompleted = 0;
        this.openPositions = [];
        this.positionMap = {};

        // Grid state
        this.gridLastPrice = 0;
        this.gridAdditions = 0;
        this.gridActive = false;
        this.gridInitialPrice = 0;

        // Startup delay
        this.startupTime = Date.now();
        this.strategyName = 'PipNex AI';
        this.strategyType = 'EA';
        this.riskLevel = 'HIGH';
        this.performance = '+167% Backtested in 2026 (Martingale)';
    }

    // ============================================================
    // Core Trading Logic
    // ============================================================

    async onTick(marketData, brokerAdapter) {
        if (!this.tradingEnabled) return;

        // Startup delay
        if (this.startupDelaySeconds > 0) {
            const elapsed = (Date.now() - this.startupTime) / 1000;
            if (elapsed < this.startupDelaySeconds) {
                return;
            }
        }

        // Time filter
        if (!this.isTradingHours(this.useTimeFilter, this.startHour, this.endHour)) return;

        // Daily reset
        this.checkDailyReset();

        // Daily loss limit
        if (this.maxDailyLoss > 0 && this.dailyLoss >= this.maxDailyLoss) {
            this.tradingEnabled = false;
            console.log(`⚠️ ${this.strategyName}: Daily loss limit reached`);
            return;
        }

        // Drawdown check
        if (await this.checkDrawdown(brokerAdapter, this.maxDrawdownPercent)) {
            this.tradingEnabled = false;
            return;
        }

        // Manage open positions (trailing stop + recovery target)
        await this.manageAllPositions(brokerAdapter);

        // Check sequence completion
        if (this.tradesInCurrentSequence >= this.tradesPerSequence) {
            this.completeSequence();
        }

        // Check recovery mode trigger (skip if grid is enabled)
        if (!this.useDrawdownGrid) {
            this.checkRecoveryModeTrigger();
        }

        // Manage grid averaging (if enabled)
        if (this.useDrawdownGrid) {
            await this.manageGrid(brokerAdapter);
        }

        // Cooldown between trades
        if (this.lastTradeTime) {
            const elapsed = (Date.now() - this.lastTradeTime) / 1000;
            if (elapsed < this.secondsBetweenTrades) return;
        }

        // Get open positions count
        const positions = await brokerAdapter.getPositions();
        const openPos = positions ? positions.filter(p => p.symbol === this.symbol).length : 0;
        if (openPos >= this.maxConcurrentPositions) return;

        // Get trading signal and execute next trade if sequence not finished
        if (this.tradesInCurrentSequence < this.tradesPerSequence) {
            const signal = this.getTradingSignal();
            if (signal === 1 && this.tradeBuy) {
                // Prevent opposite direction when positions exist
                if (this.hasOpenPositionOfDirection(-1, brokerAdapter)) return;
                await this.executeBuy(brokerAdapter);
            } else if (signal === -1 && this.tradeSell) {
                if (this.hasOpenPositionOfDirection(1, brokerAdapter)) return;
                await this.executeSell(brokerAdapter);
            }
        }
    }

    // ============================================================
    // Signal Generation
    // ============================================================

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

    // ============================================================
    // Order Execution (Buy / Sell)
    // ============================================================

    async executeBuy(brokerAdapter) {
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
            console.error(`❌ ${this.strategyName}: Failed to get quote for BUY`);
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

            console.log(`✅ ${this.strategyName} BUY - Seq ${this.sequencesCompleted + 1}, Trade ${tradeNum}/${this.tradesPerSequence}`);
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
            console.log(`❌ ${this.strategyName} BUY FAILED:`, result?.error || 'Unknown error');
        }
    }

    async executeSell(brokerAdapter) {
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
            console.error(`❌ ${this.strategyName}: Failed to get quote for SELL`);
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

            console.log(`✅ ${this.strategyName} SELL - Seq ${this.sequencesCompleted + 1}, Trade ${tradeNum}/${this.tradesPerSequence}`);
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
            console.log(`❌ ${this.strategyName} SELL FAILED:`, result?.error || 'Unknown error');
        }
    }

    // ============================================================
    // Position Management
    // ============================================================

    async manageAllPositions(brokerAdapter) {
        const positions = await brokerAdapter.getPositions();
        if (!positions || positions.length === 0) {
            this.openPositions = [];
            return;
        }

        const filteredPositions = positions.filter(p => p.symbol === this.symbol);
        this.openPositions = filteredPositions.map(p => p.id || p.positionId);

        for (const position of filteredPositions) {
            const id = position.id || position.positionId;
            const isBuy = position.type === 'BUY';
            const openPrice = position.openPrice || position.price;
            const currentPrice = isBuy ? position.bid : position.ask;
            const point = brokerAdapter.getPipSize(this.symbol);

            const profitPips = isBuy
                ? (currentPrice - openPrice) / point
                : (openPrice - currentPrice) / point;

            // Trailing Stop
            if (this.useTrailingStop && profitPips >= this.trailingStart) {
                const newSL = isBuy
                    ? currentPrice - (this.trailingDistance * point)
                    : currentPrice + (this.trailingDistance * point);

                const currentSL = position.stopLoss || 0;
                if ((isBuy && newSL > currentSL) || (!isBuy && newSL < currentSL) || currentSL === 0) {
                    await brokerAdapter.modifyStopLoss(id, newSL);
                    console.log(`🔷 ${this.strategyName} Trailing Stop: ${this.symbol} -> ${newSL.toFixed(5)}`);
                }
            }

            // Recovery Target
            if (profitPips >= this.recoveryTarget) {
                console.log(`✅ ${this.strategyName}: Recovery target reached (${profitPips.toFixed(1)} pips)`);
                await brokerAdapter.closePosition(id);
                this.openPositions = this.openPositions.filter(p => p !== id);
                delete this.positionMap[id];
            }
        }
    }

    // ============================================================
    // Grid Averaging
    // ============================================================

    async manageGrid(brokerAdapter) {
        if (!this.useDrawdownGrid) return;
        if (this.tradesInCurrentSequence === 0) { this.resetGridState(); return; }

        // Find first open position to determine direction
        const positions = await brokerAdapter.getPositions();
        if (!positions || positions.length === 0) { this.resetGridState(); return; }

        const firstPos = positions.find(p => p.symbol === this.symbol);
        if (!firstPos) { this.resetGridState(); return; }

        const dir = firstPos.type === 'BUY' ? 1 : -1;
        const entryPrice = firstPos.openPrice || firstPos.price;
        const currentPrice = firstPos.type === 'BUY' ? firstPos.bid : firstPos.ask;
        const point = brokerAdapter.getPipSize(this.symbol);

        if (!this.gridActive && this.gridAdditions === 0) {
            this.gridLastPrice = entryPrice;
            this.gridInitialPrice = entryPrice;
            this.gridActive = true;
        }

        let addPosition = false;
        if (dir === 1) {
            const bid = firstPos.bid;
            if (bid < this.gridLastPrice - this.drawdownStepPips * point) {
                addPosition = true;
            }
        } else if (dir === -1) {
            const ask = firstPos.ask;
            if (ask > this.gridLastPrice + this.drawdownStepPips * point) {
                addPosition = true;
            }
        }

        if (addPosition && this.gridAdditions < this.maxDrawdownAdditions && this.openPositions.length < this.maxConcurrentPositions) {
            let gridLot = this.initialLot;
            if (this.gridLotMultiplier !== 1.0) {
                gridLot = this.initialLot * Math.pow(this.gridLotMultiplier, this.gridAdditions + 1);
            }
            gridLot = brokerAdapter.validateLot(gridLot);

            const quote = await brokerAdapter.getQuote(this.symbol);
            if (!quote) return;

            let result;
            if (dir === 1 && this.tradeBuy) {
                const ask = quote.ask;
                const slPrice = ask - (this.initialSL * point * 10);
                const tpPrice = ask + (this.recoveryTarget * point * 10);
                result = await brokerAdapter.placeOrder(this.symbol, 'BUY', gridLot, slPrice, tpPrice);
                if (result && result.success) {
                    this.gridAdditions++;
                    this.gridLastPrice = result.price;
                    this.totalTradesExecuted++;
                    console.log(`📌 ${this.strategyName}: Grid BUY added at ${result.price} (Addition #${this.gridAdditions})`);
                }
            } else if (dir === -1 && this.tradeSell) {
                const bid = quote.bid;
                const slPrice = bid + (this.initialSL * point * 10);
                const tpPrice = bid - (this.recoveryTarget * point * 10);
                result = await brokerAdapter.placeOrder(this.symbol, 'SELL', gridLot, slPrice, tpPrice);
                if (result && result.success) {
                    this.gridAdditions++;
                    this.gridLastPrice = result.price;
                    this.totalTradesExecuted++;
                    console.log(`📌 ${this.strategyName}: Grid SELL added at ${result.price} (Addition #${this.gridAdditions})`);
                }
            }
        }

        // Check total profit of all open positions; if > 0, close all and complete sequence
        let totalProfit = 0;
        for (const pos of positions) {
            if (pos.symbol === this.symbol) {
                totalProfit += pos.profit || 0;
            }
        }

        if (totalProfit > 0 && this.gridActive) {
            console.log(`✅ ${this.strategyName}: Total floating profit = ${totalProfit.toFixed(2)} - Closing all positions.`);
            for (const pos of positions) {
                if (pos.symbol === this.symbol) {
                    await brokerAdapter.closePosition(pos.id || pos.positionId);
                }
            }
            this.openPositions = [];
            this.positionMap = {};
            this.completeSequence();
            this.resetGridState();
        }
    }

    resetGridState() {
        this.gridLastPrice = 0;
        this.gridAdditions = 0;
        this.gridActive = false;
        this.gridInitialPrice = 0;
    }

    // ============================================================
    // Sequence Management
    // ============================================================

    completeSequence() {
        this.sequencesCompleted++;
        this.tradesInCurrentSequence = 0;
        this.currentMartingaleLevel = 1;
        this.currentLotSize = this.initialLot;
        this.inRecoveryMode = false;
        this.consecutiveLosses = 0;
        this.tradesSinceLastReset = 0;
        this.sequenceDirection = 0;
        this.resetGridState();

        console.log(`✅ ${this.strategyName}: SEQUENCE ${this.sequencesCompleted} COMPLETED!`);
    }

    checkRecoveryModeTrigger() {
        if (this.inRecoveryMode) return;
        if (this.useDrawdownGrid) return;

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

        console.log(`🔴 ${this.strategyName}: RECOVERY MODE ACTIVATED`);
        console.log(`   Trigger: ${reason}`);
        console.log(`   Martingale Level: ${this.currentMartingaleLevel}`);
        console.log(`   Recovery Lot: ${this.currentLotSize}`);
        console.log(`   Target: ${this.recoveryTarget} pips`);
    }

    // ============================================================
    // Helpers
    // ============================================================

    hasOpenPositionOfDirection(direction, brokerAdapter) {
        // direction: 1 = buy, -1 = sell
        // We'll just check the openPositions list
        for (const id of this.openPositions) {
            const pos = this.positionMap[id];
            if (pos) {
                const isBuy = pos.type === 'BUY';
                if ((direction === 1 && isBuy) || (direction === -1 && !isBuy)) {
                    return true;
                }
            }
        }
        return false;
    }

    checkDailyReset() {
        const today = new Date().toDateString();
        if (today !== this.currentDay) {
            this.currentDay = today;
            this.dailyLoss = 0;
            console.log(`📅 ${this.strategyName}: New day - resetting counters`);
        }
    }

    // ============================================================
    // Control Methods
    // ============================================================

    start() {
        this.tradingEnabled = true;
        console.log(`🟢 ${this.strategyName}: STARTED`);
    }

    stop() {
        this.tradingEnabled = false;
        console.log(`🔴 ${this.strategyName}: STOPPED`);
    }

    pause() {
        this.tradingEnabled = false;
        console.log(`⏸️ ${this.strategyName}: PAUSED`);
    }

    resume() {
        this.tradingEnabled = true;
        console.log(`▶️ ${this.strategyName}: RESUMED`);
    }

    getStatus() {
        return {
            strategyName: this.strategyName,
            strategyType: this.strategyType,
            riskLevel: this.riskLevel,
            performance: this.performance,
            totalTrades: this.totalTradesExecuted,
            winningTrades: this.winningTrades,
            losingTrades: this.losingTrades,
            inRecoveryMode: this.inRecoveryMode,
            sequencesCompleted: this.sequencesCompleted,
            currentSequence: this.sequencesCompleted + 1,
            tradesInSequence: this.tradesInCurrentSequence,
            tradesPerSequence: this.tradesPerSequence,
            currentLot: this.currentLotSize,
            isRunning: this.tradingEnabled,
            openPositions: this.openPositions.length,
        };
    }

    updateConfig(config) {
        Object.assign(this, config);
        console.log(`⚙️ ${this.strategyName}: Configuration updated`);
    }
}

module.exports = { PipNexAIStrategy };
