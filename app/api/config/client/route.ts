import { NextResponse } from 'next/server';
import { loadConfig } from '../../../../lib/config';

export async function GET() {
  try {
    const config = loadConfig();
    
    // Return only the necessary config for client-side
    return NextResponse.json({
      currency: {
        name: config.currency?.name || 'VirBiCoin',
        symbol: config.currency?.symbol || 'VBC',
        unit: config.currency?.unit || 'niku',
        decimals: config.currency?.decimals || 18,
        gasUnit: config.currency?.gasUnit || 'Gniku'
      },
      explorer: {
        name: config.explorer?.name || 'VirBiCoin Explorer',
        description: config.explorer?.description || 'Real-time blockchain explorer for VirBiCoin network'
      },
      miners: config.miners || {}
    });
  } catch (error) {
    console.error('Error loading config for client:', error);
    return NextResponse.json({
      currency: {
        name: 'VirBiCoin',
        symbol: 'VBC',
        unit: 'niku',
        decimals: 18,
        gasUnit: 'Gniku'
      },
      explorer: {
        name: 'VirBiCoin Explorer',
        description: 'Real-time blockchain explorer for VirBiCoin network'
      },
      miners: {}
    }, { status: 500 });
  }
} 