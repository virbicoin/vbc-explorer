'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  IChartApi,
  CandlestickData,
  Time,
  ColorType,
  CandlestickSeries,
  ISeriesApi,
} from 'lightweight-charts';
import Image from 'next/image';

interface PriceData {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}

interface TradingPair {
  id: string;
  address: string;
  name: string;
  baseToken: TokenInfo;
  quoteToken: TokenInfo;
  reserve0: string;
  reserve1: string;
  price: number;
  priceInverse: number;
  liquidity: string;
}

// Token color mapping
const getTokenColor = (symbol: string): string => {
  const colors: Record<string, string> = {
    VBC: 'from-green-500 to-emerald-600',
    WVBC: 'from-green-500 to-emerald-600',
    VBCG: 'from-yellow-500 to-amber-600',
    USDT: 'from-emerald-500 to-teal-600',
    USDC: 'from-blue-500 to-indigo-600',
    ETH: 'from-purple-500 to-indigo-600',
    WETH: 'from-purple-500 to-indigo-600',
  };
  return colors[symbol] || 'from-gray-500 to-gray-600';
};

// Get custom icon path
const getTokenIcon = (symbol: string): string | null => {
  if (symbol === 'VBC' || symbol === 'WVBC') {
    return '/img/VBC.svg';
  }
  if (symbol === 'VBCG') {
    return '/img/VBCG.png';
  }
  if (symbol === 'USDT') {
    return '/img/USDT.svg';
  }
  return null;
};

// Token Icon Component
function TokenIcon({ symbol, size = 24 }: { symbol: string; size?: number }) {
  const iconPath = getTokenIcon(symbol);

  if (iconPath) {
    return (
      <div
        className={`rounded-full bg-gradient-to-br ${getTokenColor(symbol)} flex items-center justify-center shadow-md overflow-hidden`}
        style={{ width: size, height: size }}
      >
        <Image
          src={iconPath}
          alt={symbol}
          width={size - 4}
          height={size - 4}
          className="object-contain"
        />
      </div>
    );
  }

  return (
    <div
      className={`rounded-full bg-gradient-to-br ${getTokenColor(symbol)} flex items-center justify-center shadow-md`}
      style={{ width: size, height: size }}
    >
      <span className="font-bold text-white" style={{ fontSize: size * 0.4 }}>
        {symbol.charAt(0)}
      </span>
    </div>
  );
}

type TimeFrame = '15m' | '1h' | '4h' | '1d' | '1w';

const TIME_FRAMES: { id: TimeFrame; label: string }[] = [
  { id: '15m', label: '15m' },
  { id: '1h', label: '1H' },
  { id: '4h', label: '4H' },
  { id: '1d', label: '1D' },
  { id: '1w', label: '1W' },
];

// Fetch historical chart data from API
async function fetchChartData(pairAddress: string, timeframe: string): Promise<PriceData[]> {
  try {
    const response = await fetch(`/api/dex/chart/${pairAddress}?timeframe=${timeframe}&count=100`);
    const data = await response.json();

    if (!data.success || !data.data?.candles) {
      console.warn('Failed to fetch chart data:', data.error);
      return [];
    }

    // Convert API response to chart format
    return data.data.candles.map(
      (candle: { time: number; open: number; high: number; low: number; close: number }) => ({
        time: candle.time as Time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })
    );
  } catch (error) {
    console.error('Error fetching chart data:', error);
    return [];
  }
}

export function TradingChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  const [pairs, setPairs] = useState<TradingPair[]>([]);
  const [selectedPair, setSelectedPair] = useState<TradingPair | null>(null);
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('1h');
  const [priceData, setPriceData] = useState<PriceData[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [priceChange, setPriceChange] = useState<{ value: number; percent: number }>({
    value: 0,
    percent: 0,
  });
  const [highLow, setHighLow] = useState<{ high: number; low: number }>({ high: 0, low: 0 });
  const [showPairSelector, setShowPairSelector] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartReady, setChartReady] = useState(false);

  // Fetch pairs from API
  useEffect(() => {
    const fetchPairs = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch('/api/dex/pairs');
        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || 'Failed to fetch pairs');
        }

        if (data.data.pairs && data.data.pairs.length > 0) {
          setPairs(data.data.pairs);
          setSelectedPair(data.data.pairs[0]);
        } else {
          setError('No trading pairs available');
        }
      } catch (err) {
        console.error('Error fetching pairs:', err);
        setError(err instanceof Error ? err.message : 'Failed to load trading pairs');
      } finally {
        setLoading(false);
      }
    };

    fetchPairs();

    // Refresh pairs every 30 seconds
    const interval = setInterval(fetchPairs, 30000);
    return () => clearInterval(interval);
  }, []);

  // Update price data when pair or timeframe changes
  useEffect(() => {
    if (!selectedPair) return;

    let cancelled = false;

    const loadChartData = async () => {
      const historyData = await fetchChartData(selectedPair.address, timeFrame);

      if (cancelled) return;

      if (historyData.length > 0) {
        setPriceData(historyData);

        const price = selectedPair.price;
        setCurrentPrice(price);

        const oldest = historyData[0];
        const newest = historyData[historyData.length - 1];
        const change = newest.close - oldest.open;
        const changePercent = oldest.open !== 0 ? (change / oldest.open) * 100 : 0;
        setPriceChange({ value: change, percent: changePercent });

        const high = Math.max(...historyData.map((d) => d.high));
        const low = Math.min(...historyData.map((d) => d.low));
        setHighLow({ high, low });
      } else {
        // If no data from API, set current price info only
        setCurrentPrice(selectedPair.price);
        setPriceChange({ value: 0, percent: 0 });
        setHighLow({ high: selectedPair.price, low: selectedPair.price });
      }
    };

    loadChartData();

    return () => {
      cancelled = true;
    };
  }, [selectedPair, timeFrame]);

  // Initialize chart
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const initialWidth = Math.max(1, container.clientWidth);
    const initialHeight = Math.max(1, container.clientHeight);

    const chart = createChart(container, {
      width: initialWidth,
      height: initialHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#1f2937' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: 'rgba(75, 85, 99, 0.3)' },
        horzLines: { color: 'rgba(75, 85, 99, 0.3)' },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          width: 1,
          color: 'rgba(147, 51, 234, 0.5)',
          style: 2,
        },
        horzLine: {
          width: 1,
          color: 'rgba(147, 51, 234, 0.5)',
          style: 2,
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(75, 85, 99, 0.5)',
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
        autoScale: true,
      },
      timeScale: {
        borderColor: 'rgba(75, 85, 99, 0.5)',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
      },
      localization: {
        priceFormatter: (price: number) => {
          if (price === 0) return '0';
          if (price < 0.0001) return price.toExponential(4);
          if (price < 0.01) return price.toFixed(6);
          if (price < 1) return price.toFixed(4);
          if (price < 100) return price.toFixed(2);
          return price.toFixed(0);
        },
      },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      priceFormat: {
        type: 'price',
        precision: 6,
        minMove: 0.000001,
      },
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    setChartReady(true);

    const applySize = () => {
      const el = chartContainerRef.current;
      const api = chartRef.current;
      if (!el || !api) return;
      api.applyOptions({
        width: Math.max(1, el.clientWidth),
        height: Math.max(1, el.clientHeight),
      });
    };

    const ro = new ResizeObserver(() => applySize());
    ro.observe(container);
    const rafId = requestAnimationFrame(() => applySize());

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      setChartReady(false);
      chart.remove();
    };
  }, []);

  // Update chart data
  useEffect(() => {
    if (!chartReady) return;
    if (candlestickSeriesRef.current && priceData.length > 0) {
      candlestickSeriesRef.current.setData(priceData as CandlestickData<Time>[]);
      chartRef.current?.timeScale().fitContent();
    }
  }, [priceData, chartReady]);

  // Handle pair selection
  const handlePairSelect = (pair: TradingPair) => {
    setSelectedPair(pair);
    setShowPairSelector(false);
  };

  // Format price for display
  const formatPrice = (price: number): string => {
    if (price === 0) return '0';
    if (price < 0.00001) return price.toExponential(4);
    if (price < 0.001) return price.toFixed(8);
    if (price < 1) return price.toFixed(6);
    if (price < 100) return price.toFixed(4);
    return price.toFixed(2);
  };

  // Render header content based on state
  const renderHeader = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-between">
          <div className="h-10 bg-gray-700 rounded-xl w-32 animate-pulse"></div>
          <div className="h-8 bg-gray-700 rounded w-24 animate-pulse"></div>
        </div>
      );
    }

    if (error) {
      return <div className="text-red-400">{error}</div>;
    }

    if (!selectedPair) {
      return <div className="text-gray-400">No trading pairs available</div>;
    }

    return (
      <>
        <div className="flex items-center justify-between flex-wrap gap-4">
          {/* Pair Selector */}
          <div className="relative">
            <button
              onClick={() => setShowPairSelector(!showPairSelector)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 rounded-xl hover:bg-gray-700 transition-colors"
            >
              <div className="flex -space-x-2">
                <TokenIcon symbol={selectedPair.baseToken.symbol} size={24} />
                <TokenIcon symbol={selectedPair.quoteToken.symbol} size={24} />
              </div>
              <span className="font-bold text-white">{selectedPair.name}</span>
              <svg
                className="w-4 h-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {/* Pair Dropdown */}
            {showPairSelector && pairs.length > 0 && (
              <div className="absolute top-full left-0 mt-2 w-56 bg-gray-800 rounded-xl border border-gray-700 shadow-xl z-50 max-h-64 overflow-y-auto">
                {pairs.map((pair) => (
                  <button
                    key={pair.id}
                    onClick={() => handlePairSelect(pair)}
                    className={`w-full px-4 py-3 text-left hover:bg-gray-700 transition-colors flex items-center justify-between ${
                      selectedPair.id === pair.id ? 'bg-gray-700' : ''
                    }`}
                  >
                    <span className="font-medium text-white">{pair.name}</span>
                    <span className="text-sm text-gray-400">{formatPrice(pair.price)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Price Info */}
          <div className="flex items-center gap-6">
            <div>
              <span className="text-2xl font-bold text-white">{formatPrice(currentPrice)}</span>
              <span className="text-sm text-gray-400 ml-2">{selectedPair.quoteToken.symbol}</span>
            </div>
            <div className="hidden sm:flex items-center gap-4 text-sm">
              <div>
                <span className="text-gray-400">24h Change</span>
                <p
                  className={`font-semibold ${priceChange.percent >= 0 ? 'text-green-400' : 'text-red-400'}`}
                >
                  {priceChange.percent >= 0 ? '+' : ''}
                  {priceChange.percent.toFixed(2)}%
                </p>
              </div>
              <div>
                <span className="text-gray-400">24h High</span>
                <p className="font-semibold text-white">{formatPrice(highLow.high)}</p>
              </div>
              <div>
                <span className="text-gray-400">24h Low</span>
                <p className="font-semibold text-white">{formatPrice(highLow.low)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Timeframe Selector */}
        <div className="flex items-center gap-2 mt-4">
          {TIME_FRAMES.map((tf) => (
            <button
              key={tf.id}
              onClick={() => setTimeFrame(tf.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                timeFrame === tf.id
                  ? 'bg-purple-500 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              {tf.label}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={async () => {
              if (selectedPair) {
                const historyData = await fetchChartData(selectedPair.address, timeFrame);
                if (historyData.length > 0) {
                  setPriceData(historyData);
                }
              }
            }}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            title="Refresh"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </>
    );
  };

  return (
    <div className="bg-gray-900/90 rounded-3xl border border-gray-700/50 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-700/50">{renderHeader()}</div>

      {/* Chart Area */}
      <div
        ref={chartContainerRef}
        className="w-full"
        style={{ height: '400px', minHeight: '400px' }}
      />

      {/* Footer */}
      <div className="px-4 py-2 border-t border-gray-700/50 flex items-center justify-between text-xs text-gray-500">
        <span>Powered by Lightweight Charts</span>
        <span>Price from DEX liquidity pools</span>
      </div>
    </div>
  );
}

export default TradingChart;
