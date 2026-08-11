/**
 * Simple metrics collector for trading engine
 */
class Metrics {
    constructor() {
        this.metrics = {
            ordersPlaced: 0,
            ordersFilled: 0,
            ordersFailed: 0,
            totalProfit: 0,
            totalLoss: 0,
            startedAt: Date.now(),
        };
    }

    incrementOrdersPlaced() {
        this.metrics.ordersPlaced++;
    }

    incrementOrdersFilled() {
        this.metrics.ordersFilled++;
    }

    incrementOrdersFailed() {
        this.metrics.ordersFailed++;
    }

    addProfit(amount) {
        this.metrics.totalProfit += amount;
    }

    addLoss(amount) {
        this.metrics.totalLoss += amount;
    }

    getReport() {
        const uptime = (Date.now() - this.metrics.startedAt) / 1000;
        return {
            ...this.metrics,
            uptimeSeconds: uptime,
            winRate: this.metrics.ordersFilled / (this.metrics.ordersFilled + this.metrics.ordersFailed) * 100 || 0,
        };
    }
}

module.exports = { Metrics };
