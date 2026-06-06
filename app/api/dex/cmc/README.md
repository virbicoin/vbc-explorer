# VirBiCoin DEX - CoinMarketCap API

CoinMarketCap DEX Integration API for VirBiCoin DEX V2.

## Base URL

```
https://explorer.virbicoin.com/api/dex/cmc
```

## Endpoints

### 1. Summary
Returns summary information for all trading pairs.

**Endpoint:** `GET /api/dex/cmc/summary`

**Response Example:**
```json
{
  "VBC_VBCG": {
    "trading_pairs": "VBC_VBCG",
    "base_currency": "VBC",
    "quote_currency": "VBCG",
    "last_price": 61.65,
    "lowest_ask": 61.84,
    "highest_bid": 61.47,
    "base_volume": 0,
    "quote_volume": 0,
    "price_change_percent_24h": 0,
    "highest_price_24h": 61.65,
    "lowest_price_24h": 61.65
  }
}
```

### 2. Assets
Returns information about all supported tokens.

**Endpoint:** `GET /api/dex/cmc/assets`

**Response Example:**
```json
{
  "VBC": {
    "name": "VirBiCoin",
    "symbol": "VBC",
    "id": "VBC",
    "maker_fee": "0.3",
    "taker_fee": "0.3",
    "can_withdraw": "true",
    "can_deposit": "true",
    "min_withdraw": "0.001",
    "max_withdraw": "1000000000"
  }
}
```

### 3. Ticker
Returns 24-hour pricing and volume information for all pairs.

**Endpoint:** `GET /api/dex/cmc/ticker`

**Response Example:**
```json
{
  "VBC_VBCG": {
    "base_id": "0x52CB9F0d65D9d4De08CF103153C7A1A97567Bb9b",
    "base_name": "VBC",
    "base_symbol": "VBC",
    "quote_id": "0xac7F60af25C5c4E23d1008C46511e265A8c9B6cF",
    "quote_name": "VBCG",
    "quote_symbol": "VBCG",
    "last_price": "61.65894270418446",
    "base_volume": "0",
    "quote_volume": "0",
    "isFrozen": "0"
  }
}
```

### 4. Orderbook
Returns simulated orderbook for AMM-based trading pairs.

**Endpoint:** `GET /api/dex/cmc/orderbook/{pair}`

**Parameters:**
- `pair` - Trading pair (e.g., `VBC_VBCG`, `VBC_USDT`)

**Response Example:**
```json
{
  "timestamp": 1766160445,
  "bids": [
    ["68.010370403000649731", "646.73388215"],
    ["64.927423267791439798", "338.72136505"]
  ],
  "asks": [
    ["55.900669160745572128", "713.35331013"],
    ["58.554999167568610119", "356.67665507"]
  ]
}
```

### 5. Trades
Returns recent trades for a specific trading pair.

**Endpoint:** `GET /api/dex/cmc/trades/{pair}`

**Parameters:**
- `pair` - Trading pair (e.g., `VBC_VBCG`, `VBC_USDT`)

**Response Example:**
```json
[
  {
    "trade_id": "abc123",
    "price": "61.65",
    "base_volume": "100",
    "quote_volume": "6165",
    "timestamp": 1766160445,
    "type": "buy"
  }
]
```

## Trading Pairs

| Pair | Base | Quote | LP Token Address |
|------|------|-------|------------------|
| VBC_VBCG | VBC | VBCG | 0x3095069E8725402B43E6Ff127750E1246563e48a |
| VBC_USDT | VBC | USDT | 0xA67D40496Bd61F9c30efdb040cFCFe6701653d55 |

## Smart Contracts

- **Factory:** 0x663B1b42B79077AaC918515D3f57FED6820Dad63
- **Router:** 0xdD1Ae4345252FFEA67fE844296fbd6C973B98c18
- **WVBC:** 0x52CB9F0d65D9d4De08CF103153C7A1A97567Bb9b

## Chain Information

- **Chain Name:** VirBiCoin
- **Chain ID:** 329
- **RPC URL:** https://rpc.virbicoin.com
- **Explorer:** https://explorer.virbicoin.com

## Notes

1. This DEX uses an Automated Market Maker (AMM) model similar to Uniswap V2.
2. The orderbook endpoint provides simulated orderbook data based on the AMM price curve.
3. Trading fee is 0.3% per swap.
4. All prices are expressed as quote/base (amount of quote token for 1 base token).
