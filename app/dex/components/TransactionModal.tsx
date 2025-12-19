'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: 'pending' | 'confirming' | 'success' | 'error';
  hash?: string;
  title?: string;
  description?: string;
  errorMessage?: string;
}

export function TransactionModal({
  isOpen,
  onClose,
  status,
  hash,
  title,
  description,
  errorMessage,
}: TransactionModalProps) {
  const [isVisible, setIsVisible] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      // Use requestAnimationFrame to avoid synchronous setState in effect
      requestAnimationFrame(() => setIsVisible(true));
    } else {
      const timer = setTimeout(() => setIsVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isVisible) return null;

  const getStatusContent = () => {
    switch (status) {
      case 'pending':
        return {
          icon: (
            <div className="w-16 h-16 mx-auto mb-4 relative">
              <div className="absolute inset-0 rounded-full border-4 border-blue-500/20"></div>
              <div className="absolute inset-0 rounded-full border-4 border-blue-500 border-t-transparent animate-spin"></div>
            </div>
          ),
          title: title || 'Confirm Transaction',
          description: description || 'Please confirm the transaction in your wallet',
          color: 'blue',
        };
      case 'confirming':
        return {
          icon: (
            <div className="w-16 h-16 mx-auto mb-4 relative">
              <div className="absolute inset-0 rounded-full border-4 border-yellow-500/20"></div>
              <div className="absolute inset-0 rounded-full border-4 border-yellow-500 border-t-transparent animate-spin"></div>
            </div>
          ),
          title: title || 'Transaction Submitted',
          description: description || 'Waiting for confirmation...',
          color: 'yellow',
        };
      case 'success':
        return {
          icon: (
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          ),
          title: title || 'Transaction Successful',
          description: description || 'Your transaction has been confirmed',
          color: 'green',
        };
      case 'error':
        return {
          icon: (
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          ),
          title: title || 'Transaction Failed',
          description: errorMessage || description || 'Something went wrong',
          color: 'red',
        };
    }
  };

  const content = getStatusContent();

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={status === 'success' || status === 'error' ? onClose : undefined}
      />
      
      {/* Modal */}
      <div className={`relative bg-gray-900 rounded-3xl p-8 shadow-2xl border border-gray-700/50 max-w-sm w-full mx-4 transform transition-all duration-300 ${isOpen ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'}`}>
        {/* Close button (only for success/error) */}
        {(status === 'success' || status === 'error') && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        
        {/* Content */}
        <div className="text-center">
          {content.icon}
          <h3 className="text-xl font-bold text-white mb-2">{content.title}</h3>
          <p className="text-gray-400 text-sm">{content.description}</p>
          
          {/* Transaction hash link */}
          {hash && (status === 'success' || status === 'confirming') && (
            <a
              href={`/tx/${hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`mt-4 inline-flex items-center gap-1 text-sm text-${content.color}-400 hover:text-${content.color}-300 transition-colors`}
            >
              View transaction
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
          
          {/* Action button for success/error */}
          {(status === 'success' || status === 'error') && (
            <button
              onClick={onClose}
              className={`mt-6 w-full py-3 rounded-xl font-semibold transition-all ${
                status === 'success'
                  ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                  : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
              }`}
            >
              {status === 'success' ? 'Done' : 'Close'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Hook to manage transaction modal state
export function useTransactionModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<'pending' | 'confirming' | 'success' | 'error'>('pending');
  const [hash, setHash] = useState<string | undefined>();
  const [title, setTitle] = useState<string | undefined>();
  const [description, setDescription] = useState<string | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const showPending = (customTitle?: string, customDescription?: string) => {
    setStatus('pending');
    setTitle(customTitle);
    setDescription(customDescription);
    setHash(undefined);
    setErrorMessage(undefined);
    setIsOpen(true);
  };

  const showConfirming = (txHash: string, customTitle?: string, customDescription?: string) => {
    setStatus('confirming');
    setTitle(customTitle);
    setDescription(customDescription);
    setHash(txHash);
    setErrorMessage(undefined);
    setIsOpen(true);
  };

  const showSuccess = (txHash?: string, customTitle?: string, customDescription?: string) => {
    setStatus('success');
    setTitle(customTitle);
    setDescription(customDescription);
    if (txHash) setHash(txHash);
    setErrorMessage(undefined);
    setIsOpen(true);
  };

  const showError = (error: string | Error, customTitle?: string) => {
    setStatus('error');
    setTitle(customTitle);
    setDescription(undefined);
    setErrorMessage(typeof error === 'string' ? error : error.message);
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
  };

  const reset = () => {
    setIsOpen(false);
    setStatus('pending');
    setHash(undefined);
    setTitle(undefined);
    setDescription(undefined);
    setErrorMessage(undefined);
  };

  return {
    isOpen,
    status,
    hash,
    title,
    description,
    errorMessage,
    showPending,
    showConfirming,
    showSuccess,
    showError,
    close,
    reset,
    TransactionModal: () => (
      <TransactionModal
        isOpen={isOpen}
        onClose={close}
        status={status}
        hash={hash}
        title={title}
        description={description}
        errorMessage={errorMessage}
      />
    ),
  };
}
