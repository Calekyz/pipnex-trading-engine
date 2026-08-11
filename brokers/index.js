const { ICMarketsAdapter } = require('./ic-markets');
const { ValetaxAdapter } = require('./valetax');
const { ExnessAdapter } = require('./exness');
const { JustMarketAdapter } = require('./justmarket');
const { HFMAdapter } = require('./hfm');
const { FxProAdapter } = require('./fxpro');
const { PepperstoneAdapter } = require('./pepperstone');

class BrokerFactory {
    static create(broker, config) {
        const brokerMap = {
            'IC_MARKETS': ICMarketsAdapter,
            'VALETAX': ValetaxAdapter,
            'EXNESS': ExnessAdapter,
            'JUST_MARKET': JustMarketAdapter,
            'HFM': HFMAdapter,
            'FXPRO': FxProAdapter,
            'PEPPERSTONE': PepperstoneAdapter,
        };

        const AdapterClass = brokerMap[broker.toUpperCase()];
        if (!AdapterClass) {
            throw new Error(`Unsupported broker: ${broker}`);
        }

        return new AdapterClass(config);
    }
}

module.exports = { BrokerFactory };
