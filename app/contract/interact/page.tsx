'use client';

import { useState, useEffect, useCallback } from 'react';
import { PlayIcon, CodeBracketIcon } from '@heroicons/react/24/outline';
import { initializeCurrencyConfig, getNetworkName } from '../../../lib/client-config';

interface Method {
  name: string;
  type: 'read' | 'write';
  inputs: Array<{
    name: string;
    type: string;
  }>;
  outputs: Array<{
    name: string;
    type: string;
  }>;
  stateMutability: string;
}

interface ContractInfo {
  address: string;
  hasCode: boolean;
  abi: Array<{
    type: string;
    name: string;
    inputs: Array<{
      name: string;
      type: string;
    }>;
    outputs: Array<{
      name: string;
      type: string;
    }>;
    stateMutability: string;
  }>;
  methods: {
    read: Method[];
    write: Method[];
    all: Method[];
  };
}

export default function ContractInteractPage() {
  const [contractAddress, setContractAddress] = useState('');
  const [abi, setAbi] = useState('');

  // Get URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const address = urlParams.get('address');
    
    if (address) {
      setContractAddress(address);
    }
    
    // Initialize config to get network name
    initializeCurrencyConfig();
  }, []);
  const [contractInfo, setContractInfo] = useState<ContractInfo | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<Method | null>(null);
  const [methodParams, setMethodParams] = useState<string[]>([]);
  const [fromAddress, setFromAddress] = useState('');
  const [value, setValue] = useState('0');
  const [gasLimit, setGasLimit] = useState('3000000');
  const [gasPrice, setGasPrice] = useState('20000000000');
  const [result, setResult] = useState<{
    success: boolean;
    type?: string;
    method?: string;
    result?: unknown;
    error?: string;
    transaction?: unknown;
    estimatedGas?: string;
    message?: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchContractInfo = useCallback(async () => {
    if (!contractAddress) return;

    try {
      const response = await fetch(`/api/contract/interact?address=${contractAddress}&abi=${encodeURIComponent(abi)}`);
      const data = await response.json();
      
      if (response.ok) {
        setContractInfo(data);
      } else {
        setContractInfo(null);
        alert(data.error || 'Failed to fetch contract info');
      }
    } catch (error) {
      console.error('Error fetching contract info:', error);
      setContractInfo(null);
    }
  }, [contractAddress, abi]);

  useEffect(() => {
    if (contractAddress && abi) {
      fetchContractInfo();
    }
  }, [contractAddress, abi, fetchContractInfo]);

  const handleMethodSelect = (method: Method) => {
    setSelectedMethod(method);
    setMethodParams(new Array(method.inputs.length).fill(''));
    setResult(null);
  };

  const handleParamChange = (index: number, value: string) => {
    const newParams = [...methodParams];
    newParams[index] = value;
    setMethodParams(newParams);
  };

  const executeMethod = async () => {
    if (!selectedMethod || !contractInfo) return;

    setIsLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/contract/interact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contractAddress,
          abi: contractInfo.abi,
          method: selectedMethod.name,
          params: methodParams,
          fromAddress: selectedMethod.type === 'write' ? fromAddress : undefined,
          value: selectedMethod.type === 'write' ? value : '0',
          gasLimit: parseInt(gasLimit),
          gasPrice
        }),
      });

      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : 'Execution failed'
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="bg-gray-800 rounded-lg shadow-xl">
          <div className="px-6 py-4 border-b border-gray-700">
            <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
              <CodeBracketIcon className="w-6 h-6" />
              Contract Interaction
            </h1>
            <p className="text-gray-400 mt-2">
              Interact with smart contracts on the {getNetworkName()} blockchain.
            </p>
          </div>

          <div className="p-6 space-y-6">
            {/* Contract Setup */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Contract Address
                </label>
                <input
                  type="text"
                  value={contractAddress}
                  onChange={(e) => setContractAddress(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Contract ABI (JSON)
                </label>
                <textarea
                  value={abi}
                  onChange={(e) => setAbi(e.target.value)}
                  placeholder='[{"type":"function","name":"balanceOf","inputs":[{"name":"account","type":"address"}],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"}]'
                  rows={4}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                />
              </div>
            </div>

            {contractInfo && (
              <div className="space-y-6">
                {/* Available Methods */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-100 mb-4">Available Methods</h3>
                  
                  {/* Read Methods */}
                  {contractInfo.methods.read.length > 0 && (
                    <div className="mb-6">
                      <h4 className="text-md font-medium text-green-400 mb-2">Read Methods (View/Pure)</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {contractInfo.methods.read.map((method, index) => (
                          <button
                            key={index}
                            onClick={() => handleMethodSelect(method)}
                            className={`p-3 text-left rounded-md border transition-colors ${
                              selectedMethod?.name === method.name
                                ? 'border-green-500 bg-green-900/20 text-green-400'
                                : 'border-gray-600 bg-gray-700 text-gray-300 hover:border-gray-500'
                            }`}
                          >
                            <div className="font-medium">{method.name}</div>
                            <div className="text-xs text-gray-400 mt-1">
                              {method.inputs.length > 0 
                                ? `${method.inputs.length} input${method.inputs.length > 1 ? 's' : ''}`
                                : 'No inputs'
                              }
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Write Methods */}
                  {contractInfo.methods.write.length > 0 && (
                    <div>
                      <h4 className="text-md font-medium text-orange-400 mb-2">Write Methods (State Changing)</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {contractInfo.methods.write.map((method, index) => (
                          <button
                            key={index}
                            onClick={() => handleMethodSelect(method)}
                            className={`p-3 text-left rounded-md border transition-colors ${
                              selectedMethod?.name === method.name
                                ? 'border-orange-500 bg-orange-900/20 text-orange-400'
                                : 'border-gray-600 bg-gray-700 text-gray-300 hover:border-gray-500'
                            }`}
                          >
                            <div className="font-medium">{method.name}</div>
                            <div className="text-xs text-gray-400 mt-1">
                              {method.inputs.length > 0 
                                ? `${method.inputs.length} input${method.inputs.length > 1 ? 's' : ''}`
                                : 'No inputs'
                              }
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Method Execution */}
                {selectedMethod && (
                  <div className="bg-gray-750 rounded-lg p-6 border border-gray-600">
                    <h3 className="text-lg font-semibold text-gray-100 mb-4">
                      Execute: {selectedMethod.name}
                    </h3>

                    {/* Method Parameters */}
                    {selectedMethod.inputs.length > 0 && (
                      <div className="mb-6">
                        <h4 className="text-sm font-medium text-gray-300 mb-3">Parameters</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {selectedMethod.inputs.map((input, index) => (
                            <div key={index}>
                              <label className="block text-sm text-gray-400 mb-1">
                                {input.name || `Parameter ${index + 1}`} ({input.type})
                              </label>
                              <input
                                type="text"
                                value={methodParams[index] || ''}
                                onChange={(e) => handleParamChange(index, e.target.value)}
                                placeholder={`Enter ${input.type}`}
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Transaction Settings for Write Methods */}
                    {selectedMethod.type === 'write' && (
                      <div className="mb-6">
                        <h4 className="text-sm font-medium text-gray-300 mb-3">Transaction Settings</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                          <div>
                            <label className="block text-sm text-gray-400 mb-1">From Address</label>
                            <input
                              type="text"
                              value={fromAddress}
                              onChange={(e) => setFromAddress(e.target.value)}
                              placeholder="0x..."
                              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-gray-400 mb-1">Value (VBC)</label>
                            <input
                              type="text"
                              value={value}
                              onChange={(e) => setValue(e.target.value)}
                              placeholder="0"
                              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-gray-400 mb-1">Gas Limit</label>
                            <input
                              type="number"
                              value={gasLimit}
                              onChange={(e) => setGasLimit(e.target.value)}
                              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-gray-400 mb-1">Gas Price (Wei)</label>
                            <input
                              type="text"
                              value={gasPrice}
                              onChange={(e) => setGasPrice(e.target.value)}
                              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Execute Button */}
                    <button
                      onClick={executeMethod}
                      disabled={isLoading || (selectedMethod.type === 'write' && !fromAddress)}
                      className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {isLoading ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          Executing...
                        </>
                      ) : (
                        <>
                          <PlayIcon className="w-4 h-4" />
                          Execute {selectedMethod.type === 'read' ? 'Call' : 'Transaction'}
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Results */}
                {result && (
                  <div className="bg-gray-750 rounded-lg p-6 border border-gray-600">
                    <h3 className="text-lg font-semibold text-gray-100 mb-4">Result</h3>
                    <div className={`p-4 rounded-md ${
                      result.success 
                        ? 'bg-green-900/20 border border-green-600 text-green-400' 
                        : 'bg-red-900/20 border border-red-600 text-red-400'
                    }`}>
                      <div className="font-medium mb-2">
                        {result.success ? 'Success' : 'Error'}
                      </div>
                      {result.success ? (
                        <div>
                          {result.type === 'read' ? (
                            <div>
                              <div className="text-sm text-gray-300 mb-2">Return Value:</div>
                              <pre className="bg-gray-800 p-3 rounded text-sm overflow-x-auto">
                                {JSON.stringify(result.result, null, 2)}
                              </pre>
                            </div>
                          ) : (
                            <div>
                              <div className="text-sm text-gray-300 mb-2">Transaction Prepared:</div>
                              <pre className="bg-gray-800 p-3 rounded text-sm overflow-x-auto">
                                {JSON.stringify(result.transaction, null, 2)}
                              </pre>
                              <div className="mt-3 text-sm text-gray-300">
                                Estimated Gas: {result.estimatedGas}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm">{result.error}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
} 