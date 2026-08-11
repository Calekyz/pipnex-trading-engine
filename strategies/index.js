const { ZillionaireEA } = require('./zillionaire');
const { KaironSwingMasterStrategy } = require('./kairon-swing-master');
const { KaironScalperStrategy } = require('./kairon-scalper');
const { NovaEdgeAIStrategy } = require('./nova-edge-ai');
const { StraddleAIStrategy } = require('./straddle-ai');

// Strategy Factory
class StrategyFactory {
    static create(strategyName, config) {
        const strategyMap = {
            'Zillionaire EA': ZillionaireEA,
            'Kairon Swing Master': KaironSwingMasterStrategy,
            'Kairon Scalper Aggressive': KaironScalperStrategy,
            'Nova Edge AI': NovaEdgeAIStrategy,
            'Straddle AI': StraddleAIStrategy,
        };

        const StrategyClass = strategyMap[strategyName];
        if (!StrategyClass) {
            throw new Error(`Unknown strategy: ${strategyName}`);
        }

        return new StrategyClass(config);
    }

    static getSupportedStrategies() {
        return [
            'Zillionaire EA',
            'Kairon Swing Master',
            'Kairon Scalper Aggressive',
            'Nova Edge AI',
            'Straddle AI',
        ];
    }
}

module.exports = {
    ZillionaireEA,
    KaironSwingMasterStrategy,
    KaironScalperStrategy,
    NovaEdgeAIStrategy,
    StraddleAIStrategy,
    StrategyFactory,
};
