// Token icon mapping
// Maps token symbols or addresses to their icon paths

export const TOKEN_ICONS: Record<string, string> = {
  // By symbol
  'VBC': '/img/VBC.svg',
  'VBCG': '/img/VBCG.png',
  'VBCAT': '/img/VBCAT.png',
  'USDT': '/img/USDT.svg',
  'WVBC': '/img/VBC.svg',
  
  // LP tokens - use first token's icon or generic
  'WVBC-VBCG': '/img/VBCG.png',
  'WVBC-USDT': '/img/USDT.svg',
};

// Token color mapping (matching DEX page)
export const TOKEN_COLORS: Record<string, string> = {
  'VBC': 'from-blue-500 to-purple-600',
  'WVBC': 'from-blue-500 to-purple-600',
  'VBCG': 'from-yellow-400 to-orange-500',
  'VBCAT': 'from-pink-400 to-purple-500',
  'USDT': 'from-green-400 to-teal-500',
  'WVBC-VBCG': 'from-yellow-400 to-orange-500',
  'WVBC-USDT': 'from-green-400 to-teal-500',
};

// Get icon URL for a token by symbol or address
export function getTokenIcon(symbol?: string, address?: string): string | null {
  if (symbol && TOKEN_ICONS[symbol.toUpperCase()]) {
    return TOKEN_ICONS[symbol.toUpperCase()];
  }
  if (symbol && TOKEN_ICONS[symbol]) {
    return TOKEN_ICONS[symbol];
  }
  return null;
}

// Get token color gradient
export function getTokenColor(symbol?: string): string {
  if (!symbol) return 'from-gray-500 to-gray-600';
  const upper = symbol.toUpperCase();
  return TOKEN_COLORS[upper] || TOKEN_COLORS[symbol] || 'from-gray-500 to-gray-600';
}

// Default token icon component props
export interface TokenIconProps {
  symbol?: string;
  address?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}
