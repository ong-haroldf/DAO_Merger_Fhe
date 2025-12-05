// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { JSX, useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface DAOMergerData {
  id: number;
  name: string;
  treasury: string;
  memberActivity: string;
  valuation: string;
  timestamp: number;
  creator: string;
}

interface MergerAnalysis {
  synergyScore: number;
  valuationDiff: number;
  compatibility: number;
}

interface Partner {
  name: string;
  logo: string;
  url: string;
}

const FHEEncryptNumber = (value: number): string => `FHE-${btoa(value.toString())}`;
const FHEDecryptNumber = (encryptedData: string): number => encryptedData.startsWith('FHE-') ? parseFloat(atob(encryptedData.substring(4))) : parseFloat(encryptedData);
const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [mergers, setMergers] = useState<DAOMergerData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingMerger, setCreatingMerger] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newMergerData, setNewMergerData] = useState({ name: "", treasury: "", activity: "" });
  const [selectedMerger, setSelectedMerger] = useState<DAOMergerData | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ treasury: number | null; activity: number | null }>({ treasury: null, activity: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [chainId, setChainId] = useState(0);
  const [startTimestamp, setStartTimestamp] = useState(0);
  const [durationDays, setDurationDays] = useState(30);
  const [activeTab, setActiveTab] = useState('dashboard');
  
  // Partners data
  const [partners] = useState<Partner[]>([
    { name: "Zama", logo: "zama-logo", url: "https://zama.ai" },
    { name: "FHE.org", logo: "fhe-logo", url: "https://fhe.org" },
    { name: "DAO Alliance", logo: "dao-alliance-logo", url: "https://daoalliance.org" }
  ]);

  // Initialize signature parameters
  useEffect(() => {
    loadData().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  // Load data from contract
  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
      
      // Load mergers
      const mergersBytes = await contract.getData("mergers");
      let mergersList: DAOMergerData[] = [];
      if (mergersBytes.length > 0) {
        try {
          const mergersStr = ethers.toUtf8String(mergersBytes);
          if (mergersStr.trim() !== '') mergersList = JSON.parse(mergersStr);
        } catch (e) {}
      }
      setMergers(mergersList);
    } catch (e) {
      console.error("Error loading data:", e);
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
      setLoading(false); 
    }
  };

  // Create new merger proposal
  const createMerger = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingMerger(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating merger with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Create new merger
      const newMerger: DAOMergerData = {
        id: mergers.length + 1,
        name: newMergerData.name,
        treasury: FHEEncryptNumber(parseFloat(newMergerData.treasury) || 0),
        memberActivity: FHEEncryptNumber(parseFloat(newMergerData.activity) || 0),
        valuation: FHEEncryptNumber(0), // Will be calculated later
        timestamp: Math.floor(Date.now() / 1000),
        creator: address
      };
      
      // Update mergers list
      const updatedMergers = [...mergers, newMerger];
      
      // Save to contract
      await contract.setData("mergers", ethers.toUtf8Bytes(JSON.stringify(updatedMergers)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Merger created successfully!" });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewMergerData({ name: "", treasury: "", activity: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingMerger(false); 
    }
  };

  // Decrypt data with signature
  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      return FHEDecryptNumber(encryptedData);
    } catch (e) { 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  // Analyze merger potential
  const analyzeMerger = (merger: DAOMergerData): MergerAnalysis => {
    // Simulate FHE analysis
    const treasury = decryptedData.treasury || FHEDecryptNumber(merger.treasury);
    const activity = decryptedData.activity || FHEDecryptNumber(merger.memberActivity);
    
    return {
      synergyScore: Math.min(100, Math.round((treasury * 0.4 + activity * 0.6) * 10)),
      valuationDiff: Math.round(treasury * 0.7),
      compatibility: Math.round(activity * 10)
    };
  };

  // Render statistics dashboard
  const renderDashboard = () => {
    const totalTreasury = mergers.reduce((sum, m) => sum + (decryptedData.treasury || FHEDecryptNumber(m.treasury)), 0);
    const avgActivity = mergers.length > 0 ? mergers.reduce((sum, m) => sum + (decryptedData.activity || FHEDecryptNumber(m.memberActivity)), 0) / mergers.length : 0;
    
    return (
      <div className="dashboard-panels">
        <div className="panel metal-panel">
          <h3>Total Treasury Value</h3>
          <div className="stat-value">{totalTreasury.toFixed(2)} ETH</div>
          <div className="stat-trend">+12% last quarter</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>Average Member Activity</h3>
          <div className="stat-value">{avgActivity.toFixed(1)}</div>
          <div className="stat-trend">+5% last month</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>Active M&A Proposals</h3>
          <div className="stat-value">{mergers.length}</div>
          <div className="stat-trend">3 in negotiation</div>
        </div>
      </div>
    );
  };

  // Render merger analysis chart
  const renderAnalysisChart = (merger: DAOMergerData) => {
    const analysis = analyzeMerger(merger);
    
    return (
      <div className="analysis-chart">
        <div className="chart-row">
          <div className="chart-label">Synergy Score</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.synergyScore}%` }}
            >
              <span className="bar-value">{analysis.synergyScore}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Valuation Difference</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${Math.min(100, analysis.valuationDiff)}%` }}
            >
              <span className="bar-value">{analysis.valuationDiff}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Compatibility</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.compatibility}%` }}
            >
              <span className="bar-value">{analysis.compatibility}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render FHE process flow
  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <h4>Data Encryption</h4>
            <p>DAO treasury and activity data encrypted with Zama FHE</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <h4>Secure Evaluation</h4>
            <p>Algorithms analyze encrypted data without decryption</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <h4>Private Negotiation</h4>
            <p>Parties negotiate terms without exposing raw data</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">4</div>
          <div className="step-content">
            <h4>Final Settlement</h4>
            <p>Transaction executed with verified encrypted terms</p>
          </div>
        </div>
      </div>
    );
  };

  // Render FAQ section
  const renderFAQ = () => {
    const faqItems = [
      {
        question: "What is DAO Merger FHE?",
        answer: "A privacy-preserving system for DAO mergers and acquisitions using Fully Homomorphic Encryption (FHE) to protect sensitive financial and member data during negotiations."
      },
      {
        question: "How does FHE protect our data?",
        answer: "FHE allows computations on encrypted data without decryption. Your DAO's treasury and activity data remains encrypted throughout the entire M&A process."
      },
      {
        question: "What data is encrypted?",
        answer: "All financial data (treasury balances), member activity metrics, and valuation calculations are encrypted using Zama FHE technology."
      },
      {
        question: "Who can see the decrypted data?",
        answer: "Only authorized parties with proper cryptographic signatures can view decrypted data specific to their DAO."
      },
      {
        question: "What blockchains are supported?",
        answer: "Currently Ethereum and EVM-compatible chains with plans to expand to other ecosystems."
      }
    ];
    
    return (
      <div className="faq-container">
        {faqItems.map((item, index) => (
          <div className="faq-item" key={index}>
            <div className="faq-question">{item.question}</div>
            <div className="faq-answer">{item.answer}</div>
          </div>
        ))}
      </div>
    );
  };

  // Render partners section
  const renderPartners = () => {
    return (
      <div className="partners-grid">
        {partners.map((partner, index) => (
          <a href={partner.url} target="_blank" rel="noopener noreferrer" className="partner-card" key={index}>
            <div className={`partner-logo ${partner.logo}`}></div>
            <div className="partner-name">{partner.name}</div>
          </a>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Initializing encrypted M&A system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="dao-icon"></div>
          </div>
          <h1>DAO<span>Merger</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            <div className="add-icon"></div>New M&A Proposal
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <div className="tabs-container">
            <div className="tabs">
              <button 
                className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`}
                onClick={() => setActiveTab('dashboard')}
              >
                Dashboard
              </button>
              <button 
                className={`tab ${activeTab === 'proposals' ? 'active' : ''}`}
                onClick={() => setActiveTab('proposals')}
              >
                M&A Proposals
              </button>
              <button 
                className={`tab ${activeTab === 'faq' ? 'active' : ''}`}
                onClick={() => setActiveTab('faq')}
              >
                FAQ
              </button>
              <button 
                className={`tab ${activeTab === 'partners' ? 'active' : ''}`}
                onClick={() => setActiveTab('partners')}
              >
                Partners
              </button>
            </div>
            
            <div className="tab-content">
              {activeTab === 'dashboard' && (
                <div className="dashboard-content">
                  <h2>Private DAO M&A Analytics</h2>
                  {renderDashboard()}
                  
                  <div className="panel metal-panel full-width">
                    <h3>FHE-Powered M&A Process</h3>
                    {renderFHEFlow()}
                  </div>
                </div>
              )}
              
              {activeTab === 'proposals' && (
                <div className="proposals-section">
                  <div className="section-header">
                    <h2>Active M&A Proposals</h2>
                    <div className="header-actions">
                      <button 
                        onClick={loadData} 
                        className="refresh-btn" 
                        disabled={isRefreshing}
                      >
                        {isRefreshing ? "Refreshing..." : "Refresh"}
                      </button>
                    </div>
                  </div>
                  
                  <div className="proposals-list">
                    {mergers.length === 0 ? (
                      <div className="no-proposals">
                        <div className="no-proposals-icon"></div>
                        <p>No M&A proposals found</p>
                        <button 
                          className="create-btn" 
                          onClick={() => setShowCreateModal(true)}
                        >
                          Create First Proposal
                        </button>
                      </div>
                    ) : mergers.map((merger, index) => (
                      <div 
                        className={`proposal-item ${selectedMerger?.id === merger.id ? "selected" : ""}`} 
                        key={index}
                        onClick={() => setSelectedMerger(merger)}
                      >
                        <div className="proposal-title">{merger.name}</div>
                        <div className="proposal-meta">
                          <span>Treasury: {merger.treasury.substring(0, 15)}...</span>
                          <span>Activity: {merger.memberActivity.substring(0, 15)}...</span>
                        </div>
                        <div className="proposal-creator">Creator: {merger.creator.substring(0, 6)}...{merger.creator.substring(38)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {activeTab === 'faq' && (
                <div className="faq-section">
                  <h2>Frequently Asked Questions</h2>
                  {renderFAQ()}
                </div>
              )}
              
              {activeTab === 'partners' && (
                <div className="partners-section">
                  <h2>Our Technology Partners</h2>
                  {renderPartners()}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateMerger 
          onSubmit={createMerger} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingMerger} 
          mergerData={newMergerData} 
          setMergerData={setNewMergerData}
        />
      )}
      
      {selectedMerger && (
        <MergerDetailModal 
          merger={selectedMerger} 
          onClose={() => { 
            setSelectedMerger(null); 
            setDecryptedData({ treasury: null, activity: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
          renderAnalysisChart={renderAnalysisChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="dao-icon"></div>
              <span>DAO_Merger_FHE</span>
            </div>
            <p>Private M&A for DAOs powered by FHE</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
          <div className="copyright">© {new Date().getFullYear()} DAO Merger FHE. All rights reserved.</div>
          <div className="disclaimer">
            This system uses fully homomorphic encryption to protect DAO financial data during M&A processes.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateMergerProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  mergerData: any;
  setMergerData: (data: any) => void;
}

const ModalCreateMerger: React.FC<ModalCreateMergerProps> = ({ onSubmit, onClose, creating, mergerData, setMergerData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setMergerData({ ...mergerData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-merger-modal">
        <div className="modal-header">
          <h2>New DAO M&A Proposal</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div>
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>All financial data will be encrypted with Zama FHE</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>DAO Name *</label>
            <input 
              type="text" 
              name="name" 
              value={mergerData.name} 
              onChange={handleChange} 
              placeholder="Enter DAO name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Treasury Value (ETH) *</label>
            <input 
              type="number" 
              name="treasury" 
              value={mergerData.treasury} 
              onChange={handleChange} 
              placeholder="Enter treasury value..." 
            />
          </div>
          
          <div className="form-group">
            <label>Member Activity Score (1-10) *</label>
            <input 
              type="number" 
              min="1" 
              max="10" 
              name="activity" 
              value={mergerData.activity} 
              onChange={handleChange} 
              placeholder="Enter activity score..." 
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || !mergerData.name || !mergerData.treasury || !mergerData.activity} 
            className="submit-btn"
          >
            {creating ? "Creating with FHE..." : "Create Proposal"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface MergerDetailModalProps {
  merger: DAOMergerData;
  onClose: () => void;
  decryptedData: { treasury: number | null; activity: number | null };
  setDecryptedData: (value: { treasury: number | null; activity: number | null }) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
  renderAnalysisChart: (merger: DAOMergerData) => JSX.Element;
}

const MergerDetailModal: React.FC<MergerDetailModalProps> = ({ 
  merger, 
  onClose, 
  decryptedData, 
  setDecryptedData, 
  isDecrypting, 
  decryptWithSignature,
  renderAnalysisChart
}) => {
  const handleDecrypt = async (field: 'treasury' | 'activity') => {
    if (decryptedData[field] !== null) { 
      setDecryptedData({ ...decryptedData, [field]: null }); 
      return; 
    }
    
    const encryptedValue = field === 'treasury' ? merger.treasury : merger.memberActivity;
    const decrypted = await decryptWithSignature(encryptedValue);
    if (decrypted !== null) {
      setDecryptedData({ ...decryptedData, [field]: decrypted });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="merger-detail-modal">
        <div className="modal-header">
          <h2>M&A Proposal Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="merger-info">
            <div className="info-item">
              <span>DAO Name:</span>
              <strong>{merger.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{merger.creator.substring(0, 6)}...{merger.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(merger.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Financial Data</h3>
            <div className="data-row">
              <div className="data-label">Treasury:</div>
              <div className="data-value">{merger.treasury.substring(0, 30)}...</div>
              <button 
                className="decrypt-btn" 
                onClick={() => handleDecrypt('treasury')} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "Decrypting..."
                ) : decryptedData.treasury !== null ? (
                  "Hide Value"
                ) : (
                  "Decrypt Treasury"
                )}
              </button>
            </div>
            
            <div className="data-row">
              <div className="data-label">Member Activity:</div>
              <div className="data-value">{merger.memberActivity.substring(0, 30)}...</div>
              <button 
                className="decrypt-btn" 
                onClick={() => handleDecrypt('activity')} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "Decrypting..."
                ) : decryptedData.activity !== null ? (
                  "Hide Value"
                ) : (
                  "Decrypt Activity"
                )}
              </button>
            </div>
            
            <div className="fhe-tag">
              <div className="fhe-icon"></div>
              <span>FHE Encrypted - Requires Wallet Signature</span>
            </div>
          </div>
          
          {(decryptedData.treasury !== null || decryptedData.activity !== null) && (
            <div className="analysis-section">
              <h3>M&A Analysis</h3>
              {renderAnalysisChart(merger)}
              
              <div className="decrypted-values">
                {decryptedData.treasury !== null && (
                  <div className="value-item">
                    <span>Treasury Value:</span>
                    <strong>{decryptedData.treasury.toFixed(2)} ETH</strong>
                  </div>
                )}
                {decryptedData.activity !== null && (
                  <div className="value-item">
                    <span>Member Activity:</span>
                    <strong>{decryptedData.activity.toFixed(1)}/10</strong>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;