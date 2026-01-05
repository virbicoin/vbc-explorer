'use client';

import { useState, useEffect, Suspense } from 'react';
import {
  CheckCircleIcon,
  XCircleIcon,
  CodeBracketIcon,
  ClockIcon,
  ArrowPathIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface VerificationResult {
  verified: boolean;
  contract?: {
    address: string;
    contractName: string;
    compilerVersion: string;
    optimization: boolean;
    sourceCode: string;
    abi: string;
    byteCode: string;
    verified: boolean;
    verifiedAt: string;
  };
  message: string;
  error?: string;
  details?: unknown;
}

interface FormData {
  address: string;
  contractName: string;
  compilerVersion: string;
  optimization: boolean;
  optimizationRuns: number;
  sourceCode: string;
  constructorArgs: string;
  evmVersion: string;
  licenseType: string;
}

// エラー箇所の型定義を追加
interface CompilationError {
  type?: string;
  message?: string;
  sourceLocation?: {
    file?: string;
    start?: number;
    end?: number;
  };
  formattedMessage?: string;
  severity?: string;
}

interface ComparisonResults {
  isVerified1?: boolean;
  isVerified2?: boolean;
  isVerified3?: boolean;
  isVerified4?: boolean;
}

// LaunchpadTokenV2 source code for auto-fill (compressed format that works with verification)
const LAUNCHPAD_TOKEN_V2_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IERC20Metadata is IERC20 {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }
    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }
    function _contextSuffixLength() internal view virtual returns (uint256) {
        return 0;
    }
}

abstract contract Ownable is Context {
    address private _owner;
    error OwnableUnauthorizedAccount(address account);
    error OwnableInvalidOwner(address owner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    constructor(address initialOwner) {
        if (initialOwner == address(0)) { revert OwnableInvalidOwner(address(0)); }
        _transferOwnership(initialOwner);
    }
    modifier onlyOwner() { _checkOwner(); _; }
    function owner() public view virtual returns (address) { return _owner; }
    function _checkOwner() internal view virtual {
        if (owner() != _msgSender()) { revert OwnableUnauthorizedAccount(_msgSender()); }
    }
    function renounceOwnership() public virtual onlyOwner { _transferOwnership(address(0)); }
    function transferOwnership(address newOwner) public virtual onlyOwner {
        if (newOwner == address(0)) { revert OwnableInvalidOwner(address(0)); }
        _transferOwnership(newOwner);
    }
    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}

abstract contract Pausable is Context {
    bool private _paused;
    event Paused(address account);
    event Unpaused(address account);
    error EnforcedPause();
    error ExpectedPause();
    constructor() { _paused = false; }
    modifier whenNotPaused() { _requireNotPaused(); _; }
    modifier whenPaused() { _requirePaused(); _; }
    function paused() public view virtual returns (bool) { return _paused; }
    function _requireNotPaused() internal view virtual { if (paused()) { revert EnforcedPause(); } }
    function _requirePaused() internal view virtual { if (!paused()) { revert ExpectedPause(); } }
    function _pause() internal virtual whenNotPaused { _paused = true; emit Paused(_msgSender()); }
    function _unpause() internal virtual whenPaused { _paused = false; emit Unpaused(_msgSender()); }
}

abstract contract ERC20 is Context, IERC20, IERC20Metadata {
    mapping(address account => uint256) private _balances;
    mapping(address owner => mapping(address spender => uint256)) private _allowances;
    uint256 private _totalSupply;
    string private _name;
    string private _symbol;
    error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed);
    error ERC20InvalidSender(address sender);
    error ERC20InvalidReceiver(address receiver);
    error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed);
    error ERC20InvalidApprover(address approver);
    error ERC20InvalidSpender(address spender);
    constructor(string memory name_, string memory symbol_) { _name = name_; _symbol = symbol_; }
    function name() public view virtual returns (string memory) { return _name; }
    function symbol() public view virtual returns (string memory) { return _symbol; }
    function decimals() public view virtual returns (uint8) { return 18; }
    function totalSupply() public view virtual returns (uint256) { return _totalSupply; }
    function balanceOf(address account) public view virtual returns (uint256) { return _balances[account]; }
    function transfer(address to, uint256 value) public virtual returns (bool) {
        address owner = _msgSender();
        _transfer(owner, to, value);
        return true;
    }
    function allowance(address owner, address spender) public view virtual returns (uint256) { return _allowances[owner][spender]; }
    function approve(address spender, uint256 value) public virtual returns (bool) {
        address owner = _msgSender();
        _approve(owner, spender, value);
        return true;
    }
    function transferFrom(address from, address to, uint256 value) public virtual returns (bool) {
        address spender = _msgSender();
        _spendAllowance(from, spender, value);
        _transfer(from, to, value);
        return true;
    }
    function _transfer(address from, address to, uint256 value) internal virtual {
        if (from == address(0)) { revert ERC20InvalidSender(address(0)); }
        if (to == address(0)) { revert ERC20InvalidReceiver(address(0)); }
        _update(from, to, value);
    }
    function _update(address from, address to, uint256 value) internal virtual {
        if (from == address(0)) {
            _totalSupply += value;
        } else {
            uint256 fromBalance = _balances[from];
            if (fromBalance < value) { revert ERC20InsufficientBalance(from, fromBalance, value); }
            unchecked { _balances[from] = fromBalance - value; }
        }
        if (to == address(0)) {
            unchecked { _totalSupply -= value; }
        } else {
            unchecked { _balances[to] += value; }
        }
        emit Transfer(from, to, value);
    }
    function _mint(address account, uint256 value) internal {
        if (account == address(0)) { revert ERC20InvalidReceiver(address(0)); }
        _update(address(0), account, value);
    }
    function _burn(address account, uint256 value) internal {
        if (account == address(0)) { revert ERC20InvalidSender(address(0)); }
        _update(account, address(0), value);
    }
    function _approve(address owner, address spender, uint256 value) internal { _approve(owner, spender, value, true); }
    function _approve(address owner, address spender, uint256 value, bool emitEvent) internal virtual {
        if (owner == address(0)) { revert ERC20InvalidApprover(address(0)); }
        if (spender == address(0)) { revert ERC20InvalidSpender(address(0)); }
        _allowances[owner][spender] = value;
        if (emitEvent) { emit Approval(owner, spender, value); }
    }
    function _spendAllowance(address owner, address spender, uint256 value) internal virtual {
        uint256 currentAllowance = allowance(owner, spender);
        if (currentAllowance < type(uint256).max) {
            if (currentAllowance < value) { revert ERC20InsufficientAllowance(spender, currentAllowance, value); }
            unchecked { _approve(owner, spender, currentAllowance - value, false); }
        }
    }
}

abstract contract ERC20Burnable is Context, ERC20 {
    function burn(uint256 value) public virtual { _burn(_msgSender(), value); }
    function burnFrom(address account, uint256 value) public virtual {
        _spendAllowance(account, _msgSender(), value);
        _burn(account, value);
    }
}

abstract contract ERC20Pausable is ERC20, Pausable {
    function _update(address from, address to, uint256 value) internal virtual override {
        super._update(from, to, value);
        if (paused()) { revert EnforcedPause(); }
    }
}

contract LaunchpadTokenV2 is ERC20, ERC20Burnable, ERC20Pausable, Ownable {
    uint8 private _decimals;
    uint256 private _createdAt;
    string private _logoUrl;
    string private _description;
    string private _website;
    event MetadataUpdated(string logoUrl, string description, string website);
    constructor(
        string memory name_, string memory symbol_, uint8 decimals_, uint256 initialSupply_,
        address owner_, string memory logoUrl_, string memory description_, string memory website_
    ) ERC20(name_, symbol_) Ownable(owner_) {
        _decimals = decimals_;
        _createdAt = block.timestamp;
        _logoUrl = logoUrl_;
        _description = description_;
        _website = website_;
        _mint(owner_, initialSupply_);
    }
    function decimals() public view virtual override returns (uint8) { return _decimals; }
    function createdAt() public view returns (uint256) { return _createdAt; }
    function logoUrl() public view returns (string memory) { return _logoUrl; }
    function description() public view returns (string memory) { return _description; }
    function website() public view returns (string memory) { return _website; }
    function setLogoUrl(string memory logoUrl_) public onlyOwner { _logoUrl = logoUrl_; emit MetadataUpdated(_logoUrl, _description, _website); }
    function setDescription(string memory description_) public onlyOwner { _description = description_; emit MetadataUpdated(_logoUrl, _description, _website); }
    function setWebsite(string memory website_) public onlyOwner { _website = website_; emit MetadataUpdated(_logoUrl, _description, _website); }
    function pause() public onlyOwner { _pause(); }
    function unpause() public onlyOwner { _unpause(); }
    function getTokenDetails() public view returns (
        address creator, string memory name_, string memory symbol_, uint8 decimals_,
        uint256 totalSupply_, uint256 createdAt_, string memory logoUrl_,
        string memory description_, string memory website_
    ) {
        return (owner(), name(), symbol(), decimals(), totalSupply(), _createdAt, _logoUrl, _description, _website);
    }
    function _update(address from, address to, uint256 value) internal virtual override(ERC20, ERC20Pausable) { super._update(from, to, value); }
}`;

const COMPILER_VERSIONS = [
  { value: '0.8.30', label: '0.8.30 (Latest)' },
  { value: '0.8.29', label: '0.8.29' },
  { value: '0.8.28', label: '0.8.28' },
  { value: '0.8.27', label: '0.8.27' },
  { value: '0.8.26', label: '0.8.26' },
  { value: '0.8.25', label: '0.8.25' },
  { value: '0.8.24', label: '0.8.24' },
  { value: '0.8.23', label: '0.8.23' },
  { value: '0.8.22', label: '0.8.22' },
  { value: '0.8.21', label: '0.8.21' },
  { value: '0.8.20', label: '0.8.20' },
  { value: '0.8.19', label: '0.8.19' },
  { value: '0.8.18', label: '0.8.18' },
  { value: '0.8.17', label: '0.8.17' },
];

const LICENSE_TYPES = [
  { value: '', label: 'No License (None)' },
  { value: 'MIT', label: 'MIT License' },
  { value: 'GPL-3.0', label: 'GNU GPLv3' },
  { value: 'LGPL-3.0', label: 'GNU LGPLv3' },
  { value: 'BSD-2-Clause', label: 'BSD 2-Clause' },
  { value: 'BSD-3-Clause', label: 'BSD 3-Clause' },
  { value: 'MPL-2.0', label: 'Mozilla Public License 2.0' },
  { value: 'Apache-2.0', label: 'Apache 2.0' },
  { value: 'UNLICENSED', label: 'Unlicensed' },
];

const EVM_VERSIONS = [
  { value: 'paris', label: 'paris (default)' },
  { value: 'shanghai', label: 'shanghai' },
  { value: 'london', label: 'london' },
  { value: 'berlin', label: 'berlin' },
  { value: 'istanbul', label: 'istanbul' },
];

function useInitFormData(setFormData: React.Dispatch<React.SetStateAction<FormData>>) {
  const searchParams = useSearchParams();

  const address = searchParams.get('address');
  const contractName = searchParams.get('contractName');
  const isLaunchpadToken = searchParams.get('isLaunchpadToken') === 'true';

  useEffect(() => {
    // Auto-fill source code for Launchpad tokens
    if (isLaunchpadToken) {
      setFormData({
        address: address || '',
        contractName: contractName || '',
        sourceCode: LAUNCHPAD_TOKEN_V2_SOURCE,
        compilerVersion: '0.8.30',
        optimization: true,
        optimizationRuns: 200,
        evmVersion: 'paris',
        licenseType: 'MIT',
        constructorArgs: '',
      });
    } else {
      setFormData((prev) => ({
        ...prev,
        address: address || '',
        contractName: contractName || '',
      }));
    }
  }, [address, contractName, isLaunchpadToken, setFormData]);
}

function ContractVerifyPageInner() {
  const [networkConfig, setNetworkConfig] = useState<{
    chainId: number;
    name: string;
    rpcUrl: string;
    explorer: string;
  } | null>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch('/api/config/client');
        if (response.ok) {
          const data = await response.json();
          setNetworkConfig(data.network);
        }
      } catch (error) {
        console.error('Failed to fetch config:', error);
      }
    };
    fetchConfig();
  }, []);

  const [formData, setFormData] = useState<FormData>({
    address: '',
    contractName: '',
    compilerVersion: '0.8.30',
    optimization: false,
    optimizationRuns: 200,
    sourceCode: '',
    constructorArgs: '',
    evmVersion: 'paris',
    licenseType: '',
  });

  useInitFormData(setFormData);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/contract/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        setResult({
          verified: false,
          message: data.error || `HTTP error! status: ${response.status}`,
          error: data.error || 'Verification failed',
          details: data.details || data.receivedData || null,
        });
        return;
      }

      setResult(data);
    } catch (error) {
      setResult({
        verified: false,
        message: 'Verification failed due to network or server error',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        details: null,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (field: keyof FormData, value: string | boolean | number) => {
    // Auto-detect contract name from source code
    if (field === 'sourceCode' && typeof value === 'string') {
      const contractMatches = value.match(/contract\s+([A-Za-z0-9_]+)/g);
      if (contractMatches && contractMatches.length > 0 && !formData.contractName) {
        const lastContractMatch = contractMatches[contractMatches.length - 1];
        const detectedName = lastContractMatch.replace(/contract\s+/, '');
        setFormData((prev) => ({
          ...prev,
          [field]: value,
          contractName: detectedName,
        }));
        return;
      }
    }
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const renderErrorDetails = (details: unknown): React.ReactNode => {
    if (!details) return null;

    if (Array.isArray(details)) {
      return details.map((error: CompilationError, index: number) => (
        <div key={index} className="p-2 bg-red-900/20 border border-red-600 rounded text-sm">
          <div className="font-medium text-red-400">
            {error.type || 'Error'}: {error.message}
          </div>
          {error.formattedMessage && (
            <div className="text-xs text-gray-400 mt-1">{error.formattedMessage}</div>
          )}
        </div>
      ));
    }

    if (typeof details === 'string') {
      return (
        <div className="p-2 bg-red-900/20 border border-red-600 rounded">
          <div className="text-red-400 text-sm">{details}</div>
        </div>
      );
    }

    if (typeof details === 'object' && details !== null) {
      const detailsObj = details as Record<string, unknown>;
      if ('originalOnchainBytecodeLength' in detailsObj) {
        const comparisonResults = detailsObj.comparisonResults as ComparisonResults | undefined;
        return (
          <div className="p-3 bg-gray-800 border border-gray-700 rounded text-sm">
            <div className="text-gray-300 mb-2">Bytecode comparison details:</div>
            <div className="text-xs text-gray-400 space-y-1 font-mono">
              <div>Onchain bytecode: {String(detailsObj.originalOnchainBytecodeLength)} bytes</div>
              <div>
                Compiled bytecode: {String(detailsObj.originalCompiledBytecodeLength)} bytes
              </div>
              <div className="mt-2">Comparison results:</div>
              <div className="ml-2">
                <div>• Includes check: {comparisonResults?.isVerified1 ? '✅' : '❌'}</div>
                <div>• Reverse includes: {comparisonResults?.isVerified2 ? '✅' : '❌'}</div>
                <div>• Exact match: {comparisonResults?.isVerified3 ? '✅' : '❌'}</div>
                <div>• Start match: {comparisonResults?.isVerified4 ? '✅' : '❌'}</div>
              </div>
            </div>
          </div>
        );
      }
      return (
        <div className="p-2 bg-gray-800 border border-gray-700 rounded">
          <pre className="text-xs text-gray-300 overflow-x-auto">
            {JSON.stringify(details, null, 2)}
          </pre>
        </div>
      );
    }

    return null;
  };

  const errorDetailsNode = result?.details ? renderErrorDetails(result.details) : null;

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Page Header */}
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-4">
            <CodeBracketIcon className="w-8 h-8 text-purple-400" />
            <h1 className="text-3xl font-bold text-gray-100">
              Verify & Publish Contract Source Code
            </h1>
          </div>
          <p className="text-gray-400">
            Source code verification provides transparency for users interacting with smart
            contracts.
          </p>
        </div>
      </div>

      <main className="container mx-auto px-4 py-8">
        {/* Result Banner */}
        {result && (
          <div
            className={`mb-6 p-4 rounded-lg border ${
              result.verified ? 'bg-green-900/20 border-green-600' : 'bg-red-900/20 border-red-600'
            }`}
          >
            <div className="flex items-center gap-3">
              {result.verified ? (
                <CheckCircleIcon className="w-6 h-6 text-green-400" />
              ) : (
                <XCircleIcon className="w-6 h-6 text-red-400" />
              )}
              <div className="flex-1">
                <div
                  className={`font-semibold text-lg ${result.verified ? 'text-green-400' : 'text-red-400'}`}
                >
                  {result.verified ? 'Verification Successful' : 'Verification Failed'}
                </div>
                <p className="text-gray-300 text-sm mt-1">{result.message}</p>
                {result.contract?.compilerVersion && (
                  <p className="text-gray-400 text-xs mt-1">
                    Compiler Version: {result.contract.compilerVersion}
                  </p>
                )}
              </div>
              {result.verified && formData.address && (
                <Link
                  href={`/contract/${formData.address}`}
                  className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                >
                  View Contract
                </Link>
              )}
            </div>
            {errorDetailsNode && <div className="mt-4">{errorDetailsNode}</div>}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Form */}
          <div className="lg:col-span-2">
            <div className="bg-gray-800 rounded-lg border border-gray-700">
              <div className="p-6 border-b border-gray-700">
                <h2 className="text-xl font-semibold text-white">Contract Source Code</h2>
                <p className="text-sm text-gray-400 mt-1">
                  Enter the Solidity source code for the contract
                </p>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-6">
                {/* Contract Address */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Contract Address <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => handleInputChange('address', e.target.value)}
                    placeholder="0x..."
                    className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    required
                    disabled={isLoading}
                  />
                </div>

                {/* Compiler & Contract Name */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Compiler Version <span className="text-red-400">*</span>
                    </label>
                    <select
                      value={formData.compilerVersion}
                      onChange={(e) => handleInputChange('compilerVersion', e.target.value)}
                      className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      disabled={isLoading}
                    >
                      {COMPILER_VERSIONS.map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Contract Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.contractName}
                      onChange={(e) => handleInputChange('contractName', e.target.value)}
                      placeholder="MyContract"
                      className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                      disabled={isLoading}
                    />
                  </div>
                </div>

                {/* Optimization Settings */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex items-center gap-3 bg-gray-700/50 px-4 py-3 rounded-lg">
                    <input
                      type="checkbox"
                      id="optimization"
                      checked={formData.optimization}
                      onChange={(e) => handleInputChange('optimization', e.target.checked)}
                      className="w-5 h-5 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500"
                      disabled={isLoading}
                    />
                    <label htmlFor="optimization" className="text-sm text-gray-300">
                      Enable Optimization
                    </label>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Optimization Runs
                    </label>
                    <input
                      type="number"
                      value={formData.optimizationRuns}
                      onChange={(e) =>
                        handleInputChange('optimizationRuns', parseInt(e.target.value) || 200)
                      }
                      className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      disabled={isLoading}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      EVM Version
                    </label>
                    <select
                      value={formData.evmVersion}
                      onChange={(e) => handleInputChange('evmVersion', e.target.value)}
                      className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      disabled={isLoading}
                    >
                      {EVM_VERSIONS.map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* License Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    License Type
                  </label>
                  <select
                    value={formData.licenseType}
                    onChange={(e) => handleInputChange('licenseType', e.target.value)}
                    className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    disabled={isLoading}
                  >
                    {LICENSE_TYPES.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Source Code */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Solidity Source Code <span className="text-red-400">*</span>
                  </label>
                  <div className="text-xs text-gray-500 mb-2 flex items-start gap-2">
                    <InformationCircleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>
                      For flattened contracts (Hardhat flatten), the system will automatically
                      extract the main contract.
                    </span>
                  </div>
                  <textarea
                    value={formData.sourceCode}
                    onChange={(e) => handleInputChange('sourceCode', e.target.value)}
                    placeholder="// SPDX-License-Identifier: MIT&#10;pragma solidity ^0.8.20;&#10;&#10;contract MyContract {&#10;    // Your code here&#10;}"
                    rows={14}
                    className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
                    required
                    disabled={isLoading}
                  />
                </div>

                {/* Constructor Arguments */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Constructor Arguments (ABI-encoded)
                  </label>
                  <input
                    type="text"
                    value={formData.constructorArgs}
                    onChange={(e) => handleInputChange('constructorArgs', e.target.value)}
                    placeholder="0x... (optional)"
                    className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
                    disabled={isLoading}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    If your contract has constructor arguments, enter them as ABI-encoded hex
                  </p>
                </div>

                {/* Submit Button */}
                <div className="flex justify-end pt-4">
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="px-8 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-semibold text-lg"
                  >
                    {isLoading ? (
                      <>
                        <ArrowPathIcon className="w-5 h-5 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      'Verify & Publish'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-6">
            {/* Tips Card */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Verification Tips</h3>
              <ul className="text-sm text-gray-400 space-y-3">
                <li className="flex gap-2">
                  <span className="text-purple-400">•</span>
                  Ensure the compiler version matches exactly what was used to deploy
                </li>
                <li className="flex gap-2">
                  <span className="text-purple-400">•</span>
                  If optimization was enabled during deployment, enable it here with the same runs
                </li>
                <li className="flex gap-2">
                  <span className="text-purple-400">•</span>
                  For flattened contracts, include all dependencies in a single file
                </li>
                <li className="flex gap-2">
                  <span className="text-purple-400">•</span>
                  Constructor arguments must be ABI-encoded (use ethers.js or web3.js to encode)
                </li>
              </ul>
            </div>

            {/* Hardhat Integration Card */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Using Hardhat?</h3>
              <p className="text-sm text-gray-400 mb-4">
                Add this to your hardhat.config.ts for automatic verification:
              </p>
              <div className="bg-gray-900 rounded-lg p-4 text-xs text-green-400 font-mono overflow-x-auto">
                <pre>{`etherscan: {
  apiKey: { ${networkConfig?.name?.toLowerCase().replace(/\s+/g, '') || 'network'}: "any-key" },
  customChains: [{
    network: "${networkConfig?.name?.toLowerCase().replace(/\s+/g, '') || 'network'}",
    chainId: ${networkConfig?.chainId || 1},
    urls: {
      apiURL: "${networkConfig?.explorer || ''}/api",
      browserURL: "${networkConfig?.explorer || ''}"
    }
  }]
}`}</pre>
              </div>
              <p className="text-sm text-gray-400 mt-4">Then verify with:</p>
              <code className="block bg-gray-900 p-3 rounded-lg text-xs text-cyan-400 mt-2 break-all">
                npx hardhat verify --network{' '}
                {networkConfig?.name?.toLowerCase().replace(/\s+/g, '') || 'network'} 0xYourContract
              </code>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function ContractVerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
          <div className="text-center">
            <ArrowPathIcon className="w-8 h-8 text-purple-400 animate-spin mx-auto mb-4" />
            <p className="text-gray-400">Loading...</p>
          </div>
        </div>
      }
    >
      <ContractVerifyPageInner />
    </Suspense>
  );
}
