import React from 'react'
import {
  SiGithub,
  SiX,
  SiBitcoin,
  SiDiscord,
  SiTelegram
} from 'react-icons/si';
import { loadConfig } from '@/lib/config';

const Footer = () => {
  const config = loadConfig();
  const copyright = config.explorer?.copyright || 'Blockchain Explorer';
  const githubUrl = config.explorer?.github || '';
  const explorerName = config.explorer?.name || 'Explorer';
  
  // Social links from config
  const social = config.social || {};
  const xUrl = social.x || '';
  const bitcointalkUrl = social.bitcointalk || '';
  const discordUrl = social.discord || '';
  const telegramUrl = social.telegram || '';
  
  // Extract repo name from github URL if available
  const githubRepoName = githubUrl ? githubUrl.split('/').pop() || 'explorer' : '';
  
  return (
        <footer className='bg-gray-900 border-t border-gray-800'>
          <div className='max-w-[1920px] mx-auto px-2 py-2 flex items-center justify-center text-gray-400'>
            <div className='space-x-2 text-sm flex items-center'>
              <span>&copy; 2024-{new Date().getFullYear()} {copyright}</span>
              {githubUrl && (
                <>
                  <span>|</span>
                  <a href={githubUrl} target='_blank' rel='noopener noreferrer' className='hover:text-gray-100 transition-colors inline-flex items-center gap-1 align-middle'>
                    <SiGithub className='w-4 h-4' />
                    <span className='align-middle' style={{ verticalAlign: 'middle' }}>{githubRepoName}</span>
                  </a>
                </>
              )}
              {xUrl && (
                <>
                  <span>|</span>
                  <a href={xUrl} target='_blank' rel='noopener noreferrer' className='hover:text-gray-100 transition-colors inline-flex items-center gap-1 align-middle' title='X (Twitter)'>
                    <SiX className='w-4 h-4' />
                  </a>
                </>
              )}
              {bitcointalkUrl && (
                <>
                  <span>|</span>
                  <a href={bitcointalkUrl} target='_blank' rel='noopener noreferrer' className='hover:text-gray-100 transition-colors inline-flex items-center gap-1 align-middle' title='Bitcointalk'>
                    <SiBitcoin className='w-4 h-4' />
                  </a>
                </>
              )}
              {discordUrl && (
                <>
                  <span>|</span>
                  <a href={discordUrl} target='_blank' rel='noopener noreferrer' className='hover:text-gray-100 transition-colors inline-flex items-center gap-1 align-middle' title='Discord'>
                    <SiDiscord className='w-4 h-4' />
                  </a>
                </>
              )}
              {telegramUrl && (
                <>
                  <span>|</span>
                  <a href={telegramUrl} target='_blank' rel='noopener noreferrer' className='hover:text-gray-100 transition-colors inline-flex items-center gap-1 align-middle' title='Telegram'>
                    <SiTelegram className='w-4 h-4' />
                  </a>
                </>
              )}
            </div>
          </div>
        </footer>
  );
}

export default Footer;