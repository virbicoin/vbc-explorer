'use client';

import { useState, useEffect, Suspense } from 'react';
import { CheckCircleIcon, XCircleIcon, CodeBracketIcon } from '@heroicons/react/24/outline';
import { useSearchParams } from 'next/navigation';

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
    sourceCode: string;
}

// エラー箇所の型定義を追加

// 追加: エラー詳細の型定義
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

// LaunchpadTokenV2 source code for auto-fill
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

function useInitFormData(setFormData: React.Dispatch<React.SetStateAction<FormData>>) {
  const searchParams = useSearchParams();
  useEffect(() => {
    const address = searchParams.get('address');
    const contractName = searchParams.get('contractName');
    const isLaunchpadToken = searchParams.get('isLaunchpadToken') === 'true';
    
    // Auto-fill source code for Launchpad tokens
    if (isLaunchpadToken) {
      setFormData(prev => ({
        ...prev,
        address: address || '',
        contractName: contractName || '',
        sourceCode: LAUNCHPAD_TOKEN_V2_SOURCE,
        compilerVersion: '0.8.30',
        optimization: true
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        address: address || '',
        contractName: contractName || ''
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function ContractVerifyPageInner() {
  const [formData, setFormData] = useState<FormData>({
    address: '',
    contractName: '',
    compilerVersion: '0.8.30', // Use latest stable version as default
    optimization: false,
    sourceCode: ''
  });

  useInitFormData(setFormData);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);

  // formData.address, contractNameが変わるたびにURLクエリパラメータを更新
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (formData.address) {
      params.set('address', formData.address);
    } else {
      params.delete('address');
    }
    if (formData.contractName) {
      params.set('contractName', formData.contractName);
    } else {
      params.delete('contractName');
    }
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  }, [formData.address, formData.contractName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setResult(null);

    try {
      console.log('Submitting verification request:', {
        address: formData.address,
        contractName: formData.contractName,
        compilerVersion: formData.compilerVersion,
        optimization: formData.optimization,
        sourceCodeLength: formData.sourceCode.length
      });

      const response = await fetch('/api/contract/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();
      
      if (!response.ok) {
        console.error('API Error Response:', data);
        setResult({
          verified: false,
          message: data.error || `HTTP error! status: ${response.status}`,
          error: data.error || 'Verification failed',
          details: data.details || data.receivedData || null
        });
        return;
      }

      setResult(data);
    } catch (error) {
      console.error('Verification error:', error);
      setResult({
        verified: false,
        message: 'Verification failed due to network or server error',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        details: null
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (field: keyof FormData, value: string | boolean) => {
    // Auto-detect contract name from source code
    if (field === 'sourceCode' && typeof value === 'string') {
      const contractMatches = value.match(/contract\s+([A-Za-z0-9_]+)/g);
      if (contractMatches && contractMatches.length > 0) {
        const lastContractMatch = contractMatches[contractMatches.length - 1];
        const detectedName = lastContractMatch.replace(/contract\s+/, '');
        // contractNameが空のときだけ自動セット
        if (!formData.contractName) {
        setFormData(prev => ({
          ...prev,
            [field]: value,
            contractName: detectedName
        }));
          return;
        }
      }
    }
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // renderErrorDetailsの返り値型を明示
  const renderErrorDetails = (details: unknown): React.ReactNode => {
    if (!details) return null;

    // Handle different error detail formats
    if (Array.isArray(details)) {
      return details.map((error: CompilationError, index: number) => (
        <div key={index} className="p-2 bg-red-900/20 border border-red-600 rounded">
          <div className="font-medium text-red-400">
            {error.type || 'Error'}: {error.message}
          </div>
          {error.sourceLocation && (
            <div className="text-xs text-gray-400 mt-1">
              File: {error.sourceLocation.file}, Line: {error.sourceLocation.start}-{error.sourceLocation.end}
            </div>
          )}
          {error.formattedMessage && (
            <div className="text-xs text-gray-400 mt-1">
              {error.formattedMessage}
            </div>
          )}
        </div>
      ));
    }

    // Handle string error details
    if (typeof details === 'string') {
      return (
        <div className="p-2 bg-red-900/20 border border-red-600 rounded">
          <div className="text-red-400">{details}</div>
        </div>
      );
    }

    // Handle object error details (including verification details)
    if (typeof details === 'object' && details !== null) {
      const detailsObj = details as Record<string, unknown>;
      
      // Check if it's verification details
      if ('originalOnchainBytecodeLength' in detailsObj) {
        const comparisonResults = detailsObj.comparisonResults as ComparisonResults | undefined;
        return (
          <div className="p-2 bg-red-900/20 border border-red-600 rounded">
            <div className="text-red-400 mb-2">Bytecode comparison failed</div>
            <div className="text-xs text-gray-300 space-y-1">
              <div>Onchain bytecode length: {String(detailsObj.originalOnchainBytecodeLength)}</div>
              <div>Compiled bytecode length: {String(detailsObj.originalCompiledBytecodeLength)}</div>
              <div>Clean onchain bytecode length: {String(detailsObj.cleanOnchainBytecodeLength)}</div>
              <div>Clean compiled bytecode length: {String(detailsObj.cleanCompiledBytecodeLength)}</div>
              <div className="mt-2">
                <div>Onchain bytecode start: {String(detailsObj.onchainBytecodeStart)}</div>
                <div>Compiled bytecode start: {String(detailsObj.compiledBytecodeStart)}</div>
              </div>
              <div className="mt-2">
                <div>Comparison results:</div>
                <div className="ml-2">
                  <div>• Includes check: {comparisonResults?.isVerified1 ? '✅' : '❌'}</div>
                  <div>• Reverse includes: {comparisonResults?.isVerified2 ? '✅' : '❌'}</div>
                  <div>• Exact match: {comparisonResults?.isVerified3 ? '✅' : '❌'}</div>
                  <div>• Start match: {comparisonResults?.isVerified4 ? '✅' : '❌'}</div>
                </div>
              </div>
            </div>
          </div>
        );
      }

      // Handle other object types
      return (
        <div className="p-2 bg-red-900/20 border border-red-600 rounded">
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
      {/* トップの帯は全幅 */}
      <div className="bg-gray-800 border-b border-gray-700 w-full">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-2">
            <CodeBracketIcon className="w-8 h-8 text-purple-400" />
            <h1 className="text-3xl font-bold text-gray-100">Verify Contract Source Code</h1>
          </div>
          <p className="text-gray-400">Verify and publish your smart contract source code on the blockchain explorer.</p>
        </div>
      </div>
      {/* カード部分は中央寄せ */}
      <main className="container mx-auto px-4 py-8">
        <div className="bg-gray-800 rounded-lg border border-gray-700 shadow-xl">
          <form onSubmit={handleSubmit} className="p-8 space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Contract Address</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => handleInputChange('address', e.target.value)}
                  placeholder="0x..."
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Contract Name</label>
                <input
                  type="text"
                  value={formData.contractName}
                  onChange={(e) => handleInputChange('contractName', e.target.value)}
                  placeholder="MyContract"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Compiler Version</label>
                <select
                  value={formData.compilerVersion}
                  onChange={(e) => handleInputChange('compilerVersion', e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="0.8.30">0.8.30 (Latest)</option>
                  <option value="0.8.29">0.8.29</option>
                  <option value="0.8.28">0.8.28</option>
                  <option value="0.8.27">0.8.27</option>
                  <option value="0.8.26">0.8.26</option>
                  <option value="0.8.25">0.8.25</option>
                  <option value="0.8.24">0.8.24</option>
                  <option value="0.8.23">0.8.23</option>
                  <option value="0.8.22">0.8.22</option>
                  <option value="0.8.21">0.8.21</option>
                  <option value="0.8.20">0.8.20</option>
                  <option value="0.8.19">0.8.19</option>
                  <option value="0.8.18">0.8.18</option>
                  <option value="0.8.17">0.8.17</option>
                  <option value="0.8.16">0.8.16</option>
                  <option value="0.8.15">0.8.15</option>
                </select>
              </div>
              <div className="flex items-center mt-6 md:mt-0">
                <input
                  type="checkbox"
                  id="optimization"
                  checked={formData.optimization}
                  onChange={(e) => handleInputChange('optimization', e.target.checked)}
                  className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                />
                <label htmlFor="optimization" className="ml-2 text-sm text-gray-300">Enable Optimization</label>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Source Code</label>
              <div className="text-xs text-gray-400 mb-2">
                Paste your complete Solidity source code. The system will automatically clean up any trailing content that doesn&apos;t belong to the contract.
                <br />
                <span className="text-blue-400">💡 Tip: For flattened contracts (Hardhat flattened), the system will automatically extract the main contract.</span>
              </div>
              <textarea
                value={formData.sourceCode}
                onChange={(e) => handleInputChange('sourceCode', e.target.value)}
                placeholder={"// SPDX-License-Identifier: MIT\npragma solidity ^0.8.19;\n\ncontract MyContract {\n  // Your contract code here\n}"}
                rows={15}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                required
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isLoading}
                className="px-8 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-lg font-bold shadow"
              >
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Verifying...
                  </>
                ) : (
                  'Verify Contract'
                )}
              </button>
            </div>
          </form>
          {result && (
            <div className="px-8 pb-8">
              <div className={`mt-6 p-6 rounded-lg border shadow-lg ${
                result.verified 
                  ? 'bg-green-900/20 border-green-600 text-green-400' 
                  : 'bg-red-900/20 border-red-600 text-red-400'
              }`}>
                <div className="flex items-center gap-3 mb-2">
                  {result.verified ? (
                    <CheckCircleIcon className="w-6 h-6 text-green-400" />
                  ) : (
                    <XCircleIcon className="w-6 h-6 text-red-400" />
                  )}
                  <span className="text-lg font-semibold">
                    {result.verified ? 'Verification Successful' : 'Verification Failed'}
                  </span>
                </div>
                <p className="text-base">{result.message}</p>
                {result.contract?.compilerVersion && (
                  <div className="mt-2 text-sm text-gray-300">
                    <span className="font-bold">Compiler Version: </span>
                    <span>{result.contract.compilerVersion}</span>
                  </div>
                )}
                {result.error && (
                  <div className="mt-2 p-2 bg-gray-800 rounded text-xs">
                    <strong>Error:</strong> {result.error}
                    {result.message && (
                      <div className="mt-1 text-gray-300">{result.message}</div>
                    )}
                      {errorDetailsNode && (
                      <div className="mt-2 p-2 bg-gray-700 rounded">
                        <strong>Compilation Errors:</strong>
                        <div className="mt-2 space-y-2">
                            {errorDetailsNode}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="mt-8 bg-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-semibold text-gray-100 mb-4">How Contract Verification Works</h2>
          <div className="space-y-4 text-gray-300">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold mt-0.5">
                1
              </div>
              <div>
                <h3 className="font-medium text-gray-200">Compile Source Code</h3>
                <p className="text-sm text-gray-400">Your Solidity source code is compiled using the specified compiler version and optimization settings.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold mt-0.5">
                2
              </div>
              <div>
                <h3 className="font-medium text-gray-200">Compare Bytecode</h3>
                <p className="text-sm text-gray-400">The compiled bytecode is compared with the bytecode stored on the blockchain at the specified address.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold mt-0.5">
                3
              </div>
              <div>
                <h3 className="font-medium text-gray-200">Verify Match</h3>
                <p className="text-sm text-gray-400">If the bytecodes match, the contract is marked as verified and the source code is published on the explorer.</p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function ContractVerifyPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ContractVerifyPageInner />
    </Suspense>
  );
} 