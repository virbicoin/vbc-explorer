# VirBiCoin DEX フロントエンド開発仕様書

## 📋 プロジェクト概要

VirBiCoinネットワーク上で動作するUniswap V2スタイルの分散型取引所（DEX）のフロントエンドを開発してください。

---

## 🌐 ネットワーク情報

```javascript
const networkConfig = {
  chainId: 329,
  chainIdHex: "0x149",
  chainName: "VirBiCoin",
  rpcUrls: ["https://rpc.digitalregion.jp"],
  blockExplorerUrls: ["https://explorer.digitalregion.jp"],
  nativeCurrency: {
    name: "VBC",
    symbol: "VBC",
    decimals: 18
  }
};
```

---

## 📍 デプロイ済みコントラクトアドレス

```javascript
const contracts = {
  // DEXコントラクト
  factory: "0xE85A5BF52711c1eD2e94C8d6c8ba6717e70FE94F",
  router: "0x9Ad9B2b3E9C6FFd90d05BC322E01ACb2876AbaA9",
  
  // Wrapped VBC（ネイティブトークンのラップ版）
  wvbc: "0x52CB9F0d65D9d4De08CF103153C7A1A97567Bb9b",
  
  // サンプルトークン
  testToken: "0x7Dcd1b201D6F7a77fc39802f33b8662946220377",
  
  // サンプルペア
  testWvbcPair: "0x79F9217C39687ffA4808032A446C3dB76970CA65"
};
```

---

## 📜 コントラクトABI

### SimpleFactory ABI

```json
[
  {
    "inputs": [{"type": "address", "name": "tokenA"}, {"type": "address", "name": "tokenB"}],
    "name": "createPair",
    "outputs": [{"type": "address", "name": "pair"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"type": "address", "name": ""}, {"type": "address", "name": ""}],
    "name": "getPair",
    "outputs": [{"type": "address", "name": ""}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "allPairsLength",
    "outputs": [{"type": "uint256", "name": ""}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"type": "uint256", "name": ""}],
    "name": "allPairs",
    "outputs": [{"type": "address", "name": ""}],
    "stateMutability": "view",
    "type": "function"
  }
]
```

### SimpleRouter ABI

```json
[
  {
    "inputs": [],
    "name": "factory",
    "outputs": [{"type": "address"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "WVBC",
    "outputs": [{"type": "address"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"type": "address", "name": "tokenA"},
      {"type": "address", "name": "tokenB"},
      {"type": "uint256", "name": "amountADesired"},
      {"type": "uint256", "name": "amountBDesired"},
      {"type": "uint256", "name": "amountAMin"},
      {"type": "uint256", "name": "amountBMin"},
      {"type": "address", "name": "to"}
    ],
    "name": "addLiquidity",
    "outputs": [
      {"type": "uint256", "name": "amountA"},
      {"type": "uint256", "name": "amountB"},
      {"type": "uint256", "name": "liquidity"}
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"type": "address", "name": "token"},
      {"type": "uint256", "name": "amountTokenDesired"},
      {"type": "uint256", "name": "amountTokenMin"},
      {"type": "uint256", "name": "amountVBCMin"},
      {"type": "address", "name": "to"}
    ],
    "name": "addLiquidityVBC",
    "outputs": [
      {"type": "uint256", "name": "amountToken"},
      {"type": "uint256", "name": "amountVBC"},
      {"type": "uint256", "name": "liquidity"}
    ],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      {"type": "uint256", "name": "amountIn"},
      {"type": "uint256", "name": "amountOutMin"},
      {"type": "address[]", "name": "path"},
      {"type": "address", "name": "to"}
    ],
    "name": "swapExactTokensForTokens",
    "outputs": [{"type": "uint256[]", "name": "amounts"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"type": "uint256", "name": "amountOutMin"},
      {"type": "address[]", "name": "path"},
      {"type": "address", "name": "to"}
    ],
    "name": "swapExactVBCForTokens",
    "outputs": [{"type": "uint256[]", "name": "amounts"}],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      {"type": "uint256", "name": "amountIn"},
      {"type": "uint256", "name": "amountOutMin"},
      {"type": "address[]", "name": "path"},
      {"type": "address", "name": "to"}
    ],
    "name": "swapExactTokensForVBC",
    "outputs": [{"type": "uint256[]", "name": "amounts"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"type": "uint256", "name": "amountIn"},
      {"type": "address[]", "name": "path"}
    ],
    "name": "getAmountsOut",
    "outputs": [{"type": "uint256[]", "name": "amounts"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"type": "address", "name": "tokenA"},
      {"type": "address", "name": "tokenB"}
    ],
    "name": "getReserves",
    "outputs": [
      {"type": "uint256", "name": "reserveA"},
      {"type": "uint256", "name": "reserveB"}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"type": "uint256", "name": "amountA"},
      {"type": "uint256", "name": "reserveA"},
      {"type": "uint256", "name": "reserveB"}
    ],
    "name": "quote",
    "outputs": [{"type": "uint256", "name": "amountB"}],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [
      {"type": "uint256", "name": "amountIn"},
      {"type": "uint256", "name": "reserveIn"},
      {"type": "uint256", "name": "reserveOut"}
    ],
    "name": "getAmountOut",
    "outputs": [{"type": "uint256", "name": "amountOut"}],
    "stateMutability": "pure",
    "type": "function"
  }
]
```

### SimplePair ABI

```json
[
  {
    "inputs": [],
    "name": "token0",
    "outputs": [{"type": "address"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "token1",
    "outputs": [{"type": "address"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getReserves",
    "outputs": [
      {"type": "uint256", "name": "_reserve0"},
      {"type": "uint256", "name": "_reserve1"}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalSupply",
    "outputs": [{"type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"type": "address", "name": ""}],
    "name": "balanceOf",
    "outputs": [{"type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"type": "address", "name": "to"},
      {"type": "uint256", "name": "value"}
    ],
    "name": "transfer",
    "outputs": [{"type": "bool"}],
    "stateMutability": "nonpayable",
    "type": "function"
  }
]
```

### ERC20 ABI（トークン共通）

```json
[
  {
    "inputs": [],
    "name": "name",
    "outputs": [{"type": "string"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "symbol",
    "outputs": [{"type": "string"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "decimals",
    "outputs": [{"type": "uint8"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalSupply",
    "outputs": [{"type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"type": "address", "name": "account"}],
    "name": "balanceOf",
    "outputs": [{"type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"type": "address", "name": "spender"},
      {"type": "uint256", "name": "amount"}
    ],
    "name": "approve",
    "outputs": [{"type": "bool"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"type": "address", "name": "owner"},
      {"type": "address", "name": "spender"}
    ],
    "name": "allowance",
    "outputs": [{"type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  }
]
```

### WVBC ABI（追加関数）

```json
[
  {
    "inputs": [],
    "name": "deposit",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [{"type": "uint256", "name": "amount"}],
    "name": "withdraw",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
]
```

---

## 🎯 必要な機能

### 1. ウォレット接続
- MetaMaskまたはWeb3対応ウォレットとの接続
- VirBiCoinネットワークへの自動切り替え/追加機能
- 接続状態の表示（アドレス、VBC残高）

### 2. スワップ機能（メイン機能）

```javascript
// VBC → Token スワップ
async function swapVBCForTokens(amountIn, tokenOut, minAmountOut, userAddress) {
  const path = [WVBC_ADDRESS, tokenOut];
  const tx = await router.swapExactVBCForTokens(
    minAmountOut,  // スリッページを考慮した最小出力
    path,
    userAddress,
    { value: amountIn }
  );
  return tx;
}

// Token → VBC スワップ
async function swapTokensForVBC(tokenIn, amountIn, minAmountOut, userAddress) {
  // 1. まずapprove
  await tokenContract.approve(ROUTER_ADDRESS, amountIn);
  
  // 2. スワップ実行
  const path = [tokenIn, WVBC_ADDRESS];
  const tx = await router.swapExactTokensForVBC(
    amountIn,
    minAmountOut,
    path,
    userAddress
  );
  return tx;
}

// Token → Token スワップ
async function swapTokensForTokens(tokenIn, tokenOut, amountIn, minAmountOut, userAddress) {
  await tokenContract.approve(ROUTER_ADDRESS, amountIn);
  const path = [tokenIn, tokenOut];
  const tx = await router.swapExactTokensForTokens(
    amountIn,
    minAmountOut,
    path,
    userAddress
  );
  return tx;
}
```

### 3. 価格見積もり

```javascript
// スワップ前の出力量を計算
async function getSwapQuote(amountIn, path) {
  const amounts = await router.getAmountsOut(amountIn, path);
  return amounts[amounts.length - 1]; // 出力量
}

// 価格インパクト計算
function calculatePriceImpact(amountIn, amountOut, reserveIn, reserveOut) {
  const spotPrice = reserveOut / reserveIn;
  const executionPrice = amountOut / amountIn;
  const priceImpact = (spotPrice - executionPrice) / spotPrice * 100;
  return priceImpact; // パーセンテージ
}
```

### 4. 流動性追加

```javascript
// VBC + Token ペアに流動性追加
async function addLiquidityVBC(tokenAddress, tokenAmount, vbcAmount, userAddress) {
  // 1. Token をapprove
  await tokenContract.approve(ROUTER_ADDRESS, tokenAmount);
  
  // 2. 流動性追加
  const tx = await router.addLiquidityVBC(
    tokenAddress,
    tokenAmount,      // amountTokenDesired
    tokenAmount * 95n / 100n, // amountTokenMin (5%スリッページ)
    vbcAmount * 95n / 100n,   // amountVBCMin
    userAddress,
    { value: vbcAmount }
  );
  return tx;
}
```

### 5. プール情報表示

```javascript
// ペアのリザーブ取得
async function getPairInfo(pairAddress) {
  const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
  const [reserve0, reserve1] = await pair.getReserves();
  const token0 = await pair.token0();
  const token1 = await pair.token1();
  const totalSupply = await pair.totalSupply();
  
  return { token0, token1, reserve0, reserve1, totalSupply };
}

// ユーザーのLP残高と占有率
async function getUserLPInfo(pairAddress, userAddress) {
  const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
  const lpBalance = await pair.balanceOf(userAddress);
  const totalSupply = await pair.totalSupply();
  const sharePercent = lpBalance * 100n / totalSupply;
  
  return { lpBalance, sharePercent };
}
```

---

## 💡 UI/UX 要件

### スワップ画面
1. **入力フィールド**: From（入力トークン）、To（出力トークン）
2. **トークン選択**: ドロップダウンまたはモーダルでトークン選択
3. **残高表示**: 各トークンの残高をリアルタイム表示
4. **見積もり表示**: 入力時に自動で出力量を計算
5. **価格情報**: 現在のレート、価格インパクト表示
6. **スリッページ設定**: 0.5%, 1%, 3% または カスタム
7. **スワップボタン**: Approve → Swap の2ステップ対応

### 流動性画面
1. **プール一覧**: 存在するペアのリスト
2. **流動性追加フォーム**: 2つのトークン量入力
3. **LP残高表示**: ユーザーの流動性ポジション

### 共通要件
- レスポンシブデザイン（モバイル対応）
- トランザクション状態の表示（Pending/Success/Failed）
- エラーハンドリングとユーザーフレンドリーなメッセージ
- ダークモード対応（推奨）

---

## ⚠️ 重要な注意事項

### スリッページ保護
```javascript
// 最小出力量の計算（例: 1%スリッページ）
const slippageBps = 100; // 1% = 100 basis points
const minAmountOut = expectedAmountOut * (10000n - BigInt(slippageBps)) / 10000n;
```

### トークンApprove確認
```javascript
// スワップ前にallowanceを確認
async function checkAndApprove(tokenAddress, spender, amount, signer) {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const allowance = await token.allowance(signer.address, spender);
  
  if (allowance < amount) {
    const tx = await token.approve(spender, amount);
    await tx.wait();
  }
}
```

### BigInt の扱い
- すべてのトークン量は `BigInt` (18 decimals)
- 表示用: `ethers.formatEther(amount)` または `ethers.formatUnits(amount, decimals)`
- 入力用: `ethers.parseEther(string)` または `ethers.parseUnits(string, decimals)`

---

## 📦 推奨技術スタック

- **フレームワーク**: Next.js 14+ (App Router)
- **Web3ライブラリ**: ethers.js v6 または viem
- **ウォレット接続**: wagmi + RainbowKit または Web3Modal
- **スタイリング**: Tailwind CSS
- **状態管理**: React Context または Zustand

---

## 🧪 テスト用トークン

開発・テスト用に以下のトークンが利用可能:

| トークン | アドレス | 初期流動性 |
|---------|---------|-----------|
| TEST | `0x7Dcd1b201D6F7a77fc39802f33b8662946220377` | 10,000 TEST / 100 VBC |

---

## 📞 サポート

- ブロックエクスプローラー: https://explorer.digitalregion.jp
- RPC エンドポイント: https://rpc.digitalregion.jp

---

*作成日: 2024年12月14日*
*DEXバージョン: SimpleDEX v1.0 (CREATE2なし)*
