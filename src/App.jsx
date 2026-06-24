import { useState, useEffect, useRef, useMemo } from 'react';
import {
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Lock,
  TrendingUp,
  Users,
  Award,
  LogOut,
  Plus,
  Trash2
} from 'lucide-react';
import confetti from 'canvas-confetti';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import ProgressionChart from './components/ProgressionChart';

gsap.registerPlugin();

const generateUniqueId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
};

export default function App() {
  // App States
  const [loading, setLoading] = useState(false);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [exchangeRate, setExchangeRate] = useState(16400);
  
  // API Keys state (Server locked vs Local storage)
  const [isLockedByServer, setIsLockedByServer] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('exchange_api_key_local') || ''); // eslint-disable-line no-unused-vars
  const [apiSecret, setApiSecret] = useState(() => localStorage.getItem('exchange_api_secret_local') || ''); // eslint-disable-line no-unused-vars
  const [useExchangeApi, setUseExchangeApi] = useState(true);
  
  // Live balance from Exchange API
  const [apiBalanceUsd, setApiBalanceUsd] = useState(0);
  
  // Cycle state from Server pool.json
  const [isStarted, setIsStarted] = useState(false);
  const [startBalanceIdr, setStartBalanceIdr] = useState(8200000);
  const [investors, setInvestors] = useState([]);
  const [chartHistory, setChartHistory] = useState([]);
  const [cycleStartTime, setCycleStartTime] = useState(null);
  const [isDbConnected, setIsDbConnected] = useState(false);
  const [poolHash, setPoolHash] = useState('');

  // Authentication state
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem('admin_session_token') || '');
  
  // Modals
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isManageInvestorsOpen, setIsManageInvestorsOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [editingInvestorId, setEditingInvestorId] = useState(null);
  const [withdrawingInvestorId, setWithdrawingInvestorId] = useState(null);
  const [withdrawAmountInput, setWithdrawAmountInput] = useState('');

  // Custom Confirmation Dialog State
  const [confirmConfig, setConfirmConfig] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null
  });

  const triggerConfirm = (title, message, onConfirm) => {
    setConfirmConfig({
      isOpen: true,
      title,
      message,
      onConfirm: () => {
        onConfirm();
        closeConfirm();
      }
    });
  };

  const closeConfirm = () => {
    setConfirmConfig(prev => ({ ...prev, isOpen: false }));
  };
  
  // Forms
  const [newInvName, setNewInvName] = useState('');
  const [newInvDeposit, setNewInvDeposit] = useState('');
  const [newInvJoinDate, setNewInvJoinDate] = useState(() => new Date().toISOString().substring(0, 10));
  const [newInvAdminFeePct, setNewInvAdminFeePct] = useState('20');
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [autoAdjustMidCycle, setAutoAdjustMidCycle] = useState(true);
  
  // Manual Pool Balance (If not using API Sync)
  const [manualPoolBalanceIdr, setManualPoolBalanceIdr] = useState(() => 
    parseFloat(localStorage.getItem('invest_manual_pool_balance') || '8200000')
  );
  const [manualPoolBalanceInput, setManualPoolBalanceInput] = useState(() => // eslint-disable-line no-unused-vars
    localStorage.getItem('invest_manual_pool_balance') || '8200000'
  );

  // UI references
  const consoleRef = useRef(null);
  const successTimeoutRef = useRef(null);
  const ratesIntervalRef = useRef(null);

  // Pool start date calculation
  const START_DATE = useMemo(() => {
    if (cycleStartTime) return new Date(cycleStartTime);
    if (investors.length === 0) return new Date('2026-06-01T00:00:00');
    const dates = investors.map(inv => new Date((inv.joinDate || '2026-06-01') + 'T00:00:00').getTime());
    const minTime = Math.min(...dates);
    return new Date(minTime);
  }, [investors, cycleStartTime]);

  // Duration clock count-up
  const [elapsed, setElapsed] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    const updateTimer = () => {
      if (!isStarted) {
        setElapsed({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }
      const diff = Date.now() - START_DATE.getTime();
      if (diff <= 0) {
        setElapsed({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }
      setElapsed({
        days: Math.floor(diff / 86400000),
        hours: Math.floor((diff % 86400000) / 3600000),
        minutes: Math.floor((diff % 3600000) / 60000),
        seconds: Math.floor((diff % 60000) / 1000),
      });
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [START_DATE, isStarted]);

  // Stagger entry animations
  useGSAP(() => {
    gsap.from('.header-animate', { opacity: 0, y: -20, duration: 0.7, ease: 'power2.out' });
    gsap.from('.card-animate', { opacity: 0, y: 30, duration: 0.8, stagger: 0.1, ease: 'power3.out', delay: 0.15 });
  }, { scope: consoleRef });

  const triggerToast = (msg, isSuccess = true) => {
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    if (isSuccess) {
      setSuccessMsg(msg);
      setErrorMsg(null);
    } else {
      setErrorMsg(msg);
      setSuccessMsg(null);
    }
    successTimeoutRef.current = setTimeout(() => {
      setSuccessMsg(null);
      setErrorMsg(null);
    }, 3500);
  };

  // Fetch exchange rate
  const fetchRates = async (silent = false) => {
    if (!silent) setRatesLoading(true);
    try {
      const res = await fetch('/api/rates');
      const data = await res.json();
      if (data.success && data.rate) {
        setExchangeRate(data.rate);
      }
    } catch (err) {
      console.error('Rates fetch failed:', err);
    } finally {
      if (!silent) setRatesLoading(false);
    }
  };

  // Fetch pool state from server
  const fetchPoolState = async () => {
    try {
      const res = await fetch('/api/pool');
      const data = await res.json();
      if (data.success && data.pool) {
        setIsStarted(data.pool.isStarted);
        setStartBalanceIdr(data.pool.startBalanceIdr || 0);
        setInvestors(data.pool.investors || []);
        setChartHistory(data.pool.history || []);
        setCycleStartTime(data.pool.cycleStartTime || null);
        setIsDbConnected(!!data.isDbConnected);
        if (data.hash) {
          setPoolHash(data.hash);
        }

        // Inisialisasi manual pool balance dari titik riwayat terakhir di server jika tersedia
        if (data.pool.history && data.pool.history.length > 0) {
          const lastHistoryPoint = data.pool.history[data.pool.history.length - 1];
          setManualPoolBalanceIdr(lastHistoryPoint.balance);
          setManualPoolBalanceInput(lastHistoryPoint.balance.toString());
        }
      }
    } catch (err) {
      console.error('Failed to fetch pool state:', err);
      triggerToast('Gagal memuat konfigurasi pool dari server.', false);
    }
  };

  // Check backend configurations & login state on mount
  useEffect(() => {
    const initApp = async () => {
      await fetchRates();
      await fetchPoolState();
      
      const savedToken = sessionStorage.getItem('admin_session_token');
      if (savedToken) {
        setIsAdmin(true);
      }

      try {
        const configRes = await fetch('/api/bybit/config');
        const configData = await configRes.json();
        if (configData.success && configData.hasServerKeys) {
          setIsLockedByServer(true);
          setUseExchangeApi(true);
        }
      } catch (err) {
        console.warn('Backend server unreachable. Client mode only.', err);
      }
    };
    initApp();

    ratesIntervalRef.current = setInterval(() => fetchRates(true), 60000);
    return () => {
      if (ratesIntervalRef.current) clearInterval(ratesIntervalRef.current);
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch Exchange details
  const fetchExchangeDetails = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const body = isLockedByServer ? {} : { apiKey, apiSecret };
      const res = await fetch('/api/bybit/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        setApiBalanceUsd(data.totalUsdValue);
        if (!silent) triggerToast('Sinkronisasi data API berhasil!');

        // Sync to history if cycle is started and admin is logged in
        const token = sessionStorage.getItem('admin_session_token') || adminToken;
        if (token && isStarted) {
          const calculatedBalanceIdr = Math.max(0, data.totalUsdValue * exchangeRate - pendingWithdrawalsMetrics.totalNet);
          const todayLabel = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
          const lastPoint = chartHistory[chartHistory.length - 1];
          if (!lastPoint || lastPoint.date !== todayLabel || Math.abs(lastPoint.balance - calculatedBalanceIdr) > 100) {
            fetch('/api/pool/history', {
              method: 'POST',
              headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ date: todayLabel, balance: calculatedBalanceIdr })
            }).then(r => r.json()).then(hData => {
              if (hData.success && hData.hash) {
                setPoolHash(hData.hash);
                if (hData.pool && hData.pool.history) {
                  setChartHistory(hData.pool.history);
                }
              }
            }).catch(err => console.error(err));
          }
        }
      } else {
        if (!silent) triggerToast(data.error || 'Autentikasi API ditolak.', false);
      }
    } catch (err) {
      console.error('API fetch failed:', err);
      if (!silent) triggerToast('Koneksi backend proxy gagal.', false);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Sync automatically if using Exchange API keys on mount
  useEffect(() => {
    if (useExchangeApi && (isLockedByServer || (apiKey && apiSecret))) {
      fetchExchangeDetails(); // eslint-disable-line react-hooks/set-state-in-effect
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useExchangeApi, isLockedByServer]);

  // Silent auto-refresh Bybit balance every 3 minutes (180000ms) to avoid API rate limits
  useEffect(() => {
    let intervalId = null;
    if (useExchangeApi && (isLockedByServer || (apiKey && apiSecret))) {
      intervalId = setInterval(() => {
        fetchExchangeDetails(true);
      }, 180000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useExchangeApi, isLockedByServer, apiKey, apiSecret]);

  // Total pending withdrawals (net and capital deduction)
  const pendingWithdrawalsMetrics = useMemo(() => { // eslint-disable-line react-hooks/preserve-manual-memoization
    let totalNet = 0;
    let totalPokok = 0;
    investors.forEach(inv => {
      if (Array.isArray(inv.pendingWithdrawals)) {
        inv.pendingWithdrawals.forEach(w => {
          totalNet += parseFloat(w.amount || 0);
          totalPokok += parseFloat(w.deltaDeposit || 0);
        });
      }
    });
    return { totalNet, totalPokok };
  }, [investors]);

  // Flattened list of all pending withdrawals across all investors
  const allPendingWithdrawals = useMemo(() => {
    const list = [];
    investors.forEach(inv => {
      if (Array.isArray(inv.pendingWithdrawals)) {
        inv.pendingWithdrawals.forEach(w => {
          list.push({
            investorId: inv.id,
            investorName: inv.name,
            ...w
          });
        });
      }
    });
    // Sort by timestamp (oldest first)
    return list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }, [investors]);

  // Current Live balance in IDR (adjusted virtually by pending withdrawals)
  const currentBalanceIdr = useMemo(() => {
    let rawBalance;
    if (useExchangeApi) {
      rawBalance = apiBalanceUsd * exchangeRate;
    } else {
      rawBalance = manualPoolBalanceIdr;
    }
    // Subtract pending net withdrawals if cycle is active to prevent profit percentage spike
    if (isStarted) {
      return Math.max(0, rawBalance - pendingWithdrawalsMetrics.totalNet);
    }
    return rawBalance;
  }, [useExchangeApi, apiBalanceUsd, exchangeRate, manualPoolBalanceIdr, isStarted, pendingWithdrawalsMetrics.totalNet]);

  const currentBalanceUsd = currentBalanceIdr / exchangeRate;

  // Determine baseline starting capital (adjusted virtually by pending withdrawals if active)
  const startingCapitalIdr = useMemo(() => {
    if (isStarted) {
      return Math.max(0, startBalanceIdr - pendingWithdrawalsMetrics.totalPokok);
    }
    return investors.reduce((sum, inv) => sum + parseFloat(inv.deposit || 0), 0);
  }, [isStarted, startBalanceIdr, investors, pendingWithdrawalsMetrics.totalPokok]);

  // Preview of deposit adjustment when entering mid-cycle
  const adjustedDepositPreview = useMemo(() => {
    const depositVal = parseFloat(newInvDeposit);
    if (!depositVal || isNaN(depositVal) || depositVal <= 0) return 0;
    if (!isStarted || startingCapitalIdr <= 0 || currentBalanceIdr <= 0 || !autoAdjustMidCycle) {
      return depositVal;
    }
    
    if (editingInvestorId) {
      const oldInv = investors.find(i => i.id === editingInvestorId);
      if (oldInv) {
        const diff = depositVal - oldInv.deposit;
        if (diff <= 0) return depositVal; // No adjustment for reduction/no change
        const adjustedDiff = Math.round(diff * (startingCapitalIdr / currentBalanceIdr));
        return oldInv.deposit + adjustedDiff;
      }
    }
    
    return Math.round(depositVal * (startingCapitalIdr / currentBalanceIdr));
  }, [newInvDeposit, isStarted, startingCapitalIdr, currentBalanceIdr, autoAdjustMidCycle, editingInvestorId, investors]);

  // Overall ROI and Profit calculations
  const totalProfitIdr = useMemo(() => {
    if (!isStarted) return 0;
    return currentBalanceIdr - startingCapitalIdr;
  }, [isStarted, currentBalanceIdr, startingCapitalIdr]);

  const totalProfitUsd = totalProfitIdr / exchangeRate;
  const totalGainPct = useMemo(() => {
    if (!isStarted || startingCapitalIdr === 0) return 0;
    return (totalProfitIdr / startingCapitalIdr) * 100;
  }, [isStarted, totalProfitIdr, startingCapitalIdr]);

  // Share and Net Profit splits calculations (adjusted virtually for pending withdrawals)
  const investorCalculations = useMemo(() => {
    // Calculate virtual deposits (actual deposit minus pending pokok withdrawals)
    const virtualInvestors = investors.map(inv => {
      let pendingPokok = 0;
      let pendingNet = 0;
      if (Array.isArray(inv.pendingWithdrawals)) {
        inv.pendingWithdrawals.forEach(w => {
          pendingPokok += parseFloat(w.deltaDeposit || 0);
          pendingNet += parseFloat(w.amount || 0);
        });
      }
      const rawDeposit = parseFloat(inv.deposit || 0);
      const virtualDeposit = Math.max(0, rawDeposit - pendingPokok);
      return {
        ...inv,
        rawDeposit,
        virtualDeposit,
        pendingPokok,
        pendingNet
      };
    });

    const totalVirtualDeposits = virtualInvestors.reduce((sum, inv) => sum + inv.virtualDeposit, 0);
    
    return virtualInvestors.map(inv => {
      const sharePct = totalVirtualDeposits > 0 ? (inv.virtualDeposit / totalVirtualDeposits) * 100 : 0;
      
      // Gross Profit share (based on virtual profit)
      const grossProfitShare = isStarted ? (sharePct / 100) * totalProfitIdr : 0;
      
      // Admin Fee (defaults to 20% if not set)
      const feePct = parseFloat(inv.adminFeePct !== undefined ? inv.adminFeePct : 20);
      const adminFee = grossProfitShare > 0 ? grossProfitShare * (feePct / 100) : 0;
      
      // Net Profit share
      const netProfitShare = grossProfitShare - adminFee;
      const currentValue = inv.virtualDeposit + netProfitShare;
      
      return {
        ...inv,
        sharePct,
        grossProfitShare,
        adminFee,
        netProfitShare,
        currentValue
      };
    });
  }, [investors, totalProfitIdr, isStarted]);

  // Selected investor for withdrawal calculations
  const withdrawingInvestorCalc = useMemo(() => {
    if (!withdrawingInvestorId) return null;
    return investorCalculations.find(i => i.id === withdrawingInvestorId);
  }, [investorCalculations, withdrawingInvestorId]);

  // Live preview for withdrawal math
  const withdrawPreview = useMemo(() => {
    const amount = parseFloat(withdrawAmountInput);
    if (isNaN(amount) || amount <= 0 || !withdrawingInvestorCalc) {
      return { deltaDeposit: 0, adminFeePaid: 0, previewRemainingNet: withdrawingInvestorCalc?.currentValue || 0 };
    }

    const P = totalGainPct / 100;
    const F = (withdrawingInvestorCalc.adminFeePct !== undefined ? withdrawingInvestorCalc.adminFeePct : 20) / 100;

    let deltaDeposit;
    let adminFeePaid;

    if (P > 0) {
      // deltaDeposit = amount / (1 + P * (1 - F))
      deltaDeposit = amount / (1 + P * (1 - F));
      adminFeePaid = deltaDeposit * P * F;
    } else {
      // deltaDeposit = amount / (1 + P) dengan pengaman division-by-zero
      deltaDeposit = (1 + P <= 0) ? 0 : amount / (1 + P);
      adminFeePaid = 0;
    }

    const previewRemainingNet = withdrawingInvestorCalc.currentValue - amount;

    return {
      deltaDeposit: Math.round(deltaDeposit),
      adminFeePaid: Math.round(adminFeePaid),
      previewRemainingNet: Math.round(previewRemainingNet)
    };
  }, [withdrawAmountInput, withdrawingInvestorCalc, totalGainPct]);

  // Total admin fee accumulated in the current cycle
  const totalAdminFeeIdr = useMemo(() => {
    return investorCalculations.reduce((sum, inv) => sum + (inv.adminFee || 0), 0);
  }, [investorCalculations]);

  // Snapshot active balance to server history
  const handleUpdateManualBalance = async (newVal) => { // eslint-disable-line no-unused-vars
    setManualPoolBalanceIdr(newVal);
    setManualPoolBalanceInput(newVal.toString());
    localStorage.setItem('invest_manual_pool_balance', newVal.toString());

    if (isStarted) {
      try {
        const token = sessionStorage.getItem('admin_session_token') || adminToken;
        const todayLabel = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
        const res = await fetch('/api/pool/history', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ date: todayLabel, balance: newVal })
        });
        const data = await res.json();
        if (data.success && data.hash) {
          setPoolHash(data.hash);
        }
        await fetchPoolState();
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Automated daily sync removed to prevent infinite loop and secure endpoint.
  // Synchronization now runs on successful Exchange Fetch or manual balance updates.

  // Progression Chart data formatting
  const chartData = useMemo(() => {
    const dataPoints = chartHistory.map(h => ({
      date: h.date,
      actual: h.balance
    }));
    
    // Add current live point at the end if today is not saved yet
    const todayLabel = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
    const hasToday = chartHistory.some(h => h.date === todayLabel);
    if (!hasToday && currentBalanceIdr > 0) {
      dataPoints.push({
        date: todayLabel,
        actual: currentBalanceIdr
      });
    }

    return dataPoints;
  }, [chartHistory, currentBalanceIdr]);

  // Win Rate calculation based on history curve
  const winRateMetrics = useMemo(() => { // eslint-disable-line no-unused-vars
    let total = 0;
    let wins = 0;
    let losses = 0;
    for (let i = 1; i < chartHistory.length; i++) {
      const diff = chartHistory[i].balance - chartHistory[i - 1].balance;
      if (diff > 0) {
        wins++;
        total++;
      } else if (diff < 0) {
        losses++;
        total++;
      }
    }
    const rate = total > 0 ? (wins / total) * 100 : 100;
    return { total, wins, losses, rate };
  }, [chartHistory]);

  // Admin auth actions
  const handleAdminLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPasswordInput })
      });
      const data = await res.json();
      if (data.success && data.token) {
        setIsAdmin(true);
        setAdminToken(data.token);
        sessionStorage.setItem('admin_session_token', data.token);
        setIsLoginOpen(false);
        setAdminPasswordInput('');
        triggerToast('Login Admin berhasil! Panel kontrol terbuka.');
      } else {
        triggerToast(data.error || 'Password salah!', false);
      }
    } catch (err) {
      console.error(err);
      triggerToast('Gagal menghubungi server.', false);
    }
  };

  const handleAdminLogout = () => {
    setIsAdmin(false);
    setAdminToken('');
    sessionStorage.removeItem('admin_session_token');
    setIsManageInvestorsOpen(false);
    triggerToast('Keluar dari mode Admin.');
  };

  // Sync update investors
  const syncInvestorsToServer = async (updatedList, newStartBalance) => {
    setLoading(true);
    try {
      const token = sessionStorage.getItem('admin_session_token') || adminToken;
      const body = { 
        investors: updatedList,
        expectedHash: poolHash
      };
      if (newStartBalance !== undefined) {
        body.startBalanceIdr = newStartBalance;
      }
      const res = await fetch('/api/pool/investors', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });
      const data = await res.json();

      if (res.status === 409) {
        triggerToast(data.error || 'Konflik data terdeteksi.', false);
        await fetchPoolState();
        return;
      }

      if (data.success) {
        if (data.hash) {
          setPoolHash(data.hash);
        }
        await fetchPoolState();
      } else {
        triggerToast(data.error || 'Gagal menyimpan perubahan ke server.', false);
      }
    } catch (err) {
      console.error(err);
      triggerToast('Koneksi server gagal saat sinkronisasi.', false);
    } finally {
      setLoading(false);
    }
  };

  // Start Cycle Action
  const handleStartCycle = () => {
    if (isStarted) return;
    if (startingCapitalIdr <= 0) {
      triggerToast('Total modal awal investor harus lebih besar dari Rp 0!', false);
      return;
    }
    
    triggerConfirm(
      'Mulai Siklus Baru',
      `Apakah Anda yakin ingin memulai siklus baru dengan Modal Awal Rp ${startingCapitalIdr.toLocaleString('id-ID')}?`,
      async () => {
        try {
          const token = sessionStorage.getItem('admin_session_token') || adminToken;
          const res = await fetch('/api/pool/start', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ startBalanceIdr: currentBalanceIdr })
          });
          const data = await res.json();
          if (data.success) {
            await fetchPoolState();
            triggerToast('Siklus investasi resmi dimulai!');
            confetti({
              particleCount: 150,
              spread: 80,
              colors: ['#d4ff3a', '#b89bfb', '#30d158']
            });
          } else {
            triggerToast(data.error || 'Gagal memulai siklus.', false);
          }
        } catch (err) {
          console.error(err);
          triggerToast('Gagal terhubung ke server.', false);
        }
      }
    );
  };

  // Reset Cycle Action (compounds net value and stops the cycle)
  const handleResetCycle = () => {
    if (!isStarted) return;

    if (allPendingWithdrawals.length > 0) {
      triggerToast('Gagal: Selesaikan atau batalkan semua pending withdrawal terlebih dahulu sebelum mereset siklus!', false);
      return;
    }
    
    triggerConfirm(
      'Reset & Gulung Siklus',
      'Apakah Anda yakin ingin mereset siklus saat ini? Tindakan ini akan membagikan profit bersih ke modal investor (compounding) dan mengunci profit berjalan.',
      async () => {
        // Compound Nilai Bersih to be the next cycle's deposit
        const compoundedInvestors = investorCalculations.map(inv => ({
          id: inv.id,
          name: inv.name,
          deposit: Math.round(inv.currentValue),
          joinDate: inv.joinDate,
          adminFeePct: inv.adminFeePct
        }));

        try {
          const token = sessionStorage.getItem('admin_session_token') || adminToken;
          const res = await fetch('/api/pool/reset', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              updatedInvestors: compoundedInvestors,
              currentBalanceIdr,
              expectedHash: poolHash
            })
          });
          const data = await res.json();

          if (res.status === 409) {
            triggerToast(data.error || 'Konflik data terdeteksi.', false);
            await fetchPoolState();
            return;
          }

          if (data.success) {
            if (data.hash) {
              setPoolHash(data.hash);
            }
            await fetchPoolState();
            triggerToast('Siklus investasi dihentikan & profit berhasil digulung!');
          } else {
            triggerToast(data.error || 'Gagal mereset siklus.', false);
          }
        } catch (err) {
          console.error(err);
          triggerToast('Gagal terhubung ke server.', false);
        }
      }
    );
  };

  // Toggle Data Source
  const handleToggleDataSource = (val) => { // eslint-disable-line no-unused-vars
    setUseExchangeApi(val);
    localStorage.setItem('invest_use_exchange_api', val.toString());
    triggerToast(val ? 'Sumber data dialihkan ke API Sync.' : 'Sumber data dialihkan ke Input Manual.');
  };

  // Reset console to defaults
  const handleResetAllData = () => {
    triggerConfirm(
      'Reset Setelan Pabrik',
      'Apakah Anda yakin ingin mereset konsol ke setelan awal pabrik? Semua data investor dan riwayat saldo saat ini akan dihapus secara permanen.',
      async () => {
        try {
          const token = sessionStorage.getItem('admin_session_token') || adminToken;
          const res = await fetch('/api/admin/reset-investors', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const data = await res.json();
          if (data.success) {
            await fetchPoolState();
            setIsManageInvestorsOpen(false);
            triggerToast('Konsol berhasil disetel ulang ke default.');
          } else {
            triggerToast(data.error || 'Gagal melakukan reset.', false);
          }
        } catch (err) {
          console.error(err);
          triggerToast('Koneksi server gagal.', false);
        }
      }
    );
  };

  // Add/Edit/Remove Investors
  const handleStartEditInvestor = (inv) => {
    setEditingInvestorId(inv.id);
    setNewInvName(inv.name);
    setNewInvDeposit(inv.deposit.toString());
    setNewInvAdminFeePct((inv.adminFeePct !== undefined ? inv.adminFeePct : 20).toString());
    setNewInvJoinDate(inv.joinDate || new Date().toISOString().substring(0, 10));
  };

  const handleCancelEdit = () => {
    setEditingInvestorId(null);
    setNewInvName('');
    setNewInvDeposit('');
    setNewInvAdminFeePct('20');
    setNewInvJoinDate(new Date().toISOString().substring(0, 10));
  };

  const handleSaveInvestor = async (e) => {
    e.preventDefault();
    if (!newInvName.trim() || !newInvDeposit || isNaN(newInvDeposit) || parseFloat(newInvDeposit) <= 0 || !newInvJoinDate || isNaN(newInvAdminFeePct)) {
      triggerToast('Data form investor tidak valid!', false);
      return;
    }

    if (editingInvestorId) {
      // Editing existing investor
      const oldInv = investors.find(i => i.id === editingInvestorId);
      if (!oldInv) return;

      const rawDepositInput = parseFloat(newInvDeposit);
      const diff = rawDepositInput - oldInv.deposit;
      let adjustedDiff = diff;
      
      // Only adjust if deposit is increased (additional capital) mid-cycle
      if (autoAdjustMidCycle && isStarted && diff > 0 && startingCapitalIdr > 0 && currentBalanceIdr > 0) {
        adjustedDiff = Math.round(diff * (startingCapitalIdr / currentBalanceIdr));
      }

      const finalDeposit = oldInv.deposit + adjustedDiff;

      const updated = investors.map(inv => {
        if (inv.id === editingInvestorId) {
          return {
            ...inv,
            name: newInvName.trim(),
            deposit: finalDeposit,
            joinDate: newInvJoinDate,
            adminFeePct: parseFloat(newInvAdminFeePct)
          };
        }
        return inv;
      });

      setInvestors(updated);
      setEditingInvestorId(null);
      setNewInvName('');
      setNewInvDeposit('');
      setNewInvAdminFeePct('20');
      setNewInvJoinDate(new Date().toISOString().substring(0, 10));

      let newStart = startBalanceIdr;
      if (isStarted) {
        newStart = startBalanceIdr + adjustedDiff;
        setStartBalanceIdr(newStart);
      }
      triggerToast('Perubahan data investor berhasil disimpan!');
      await syncInvestorsToServer(updated, newStart);
    } else {
      // Adding new investor
      const rawDepositInput = parseFloat(newInvDeposit);
      let finalDeposit = rawDepositInput;
      
      if (autoAdjustMidCycle && isStarted && startingCapitalIdr > 0 && currentBalanceIdr > 0) {
        finalDeposit = Math.round(rawDepositInput * (startingCapitalIdr / currentBalanceIdr));
      }

      const newInv = {
        id: generateUniqueId(),
        name: newInvName.trim(),
        deposit: finalDeposit,
        joinDate: newInvJoinDate,
        adminFeePct: parseFloat(newInvAdminFeePct)
      };

      const updated = [...investors, newInv];
      setInvestors(updated);
      setNewInvName('');
      setNewInvDeposit('');
      setNewInvAdminFeePct('20');
      setNewInvJoinDate(new Date().toISOString().substring(0, 10));
      
      let newStart = startBalanceIdr;
      if (isStarted) {
        newStart = startBalanceIdr + finalDeposit;
        setStartBalanceIdr(newStart);
      }
      triggerToast('Investor baru ditambahkan!');
      await syncInvestorsToServer(updated, newStart);
    }
  };

  const handleDeleteInvestor = async (id) => {
    if (investors.length <= 1) {
      triggerToast('Minimal harus menyisakan 1 investor!', false);
      return;
    }
    const targetInv = investors.find(i => i.id === id);
    if (targetInv && Array.isArray(targetInv.pendingWithdrawals) && targetInv.pendingWithdrawals.length > 0) {
      triggerToast('Gagal: Selesaikan atau batalkan pending withdrawal investor ini sebelum menghapus!', false);
      return;
    }
    const updated = investors.filter(i => i.id !== id);
    setInvestors(updated);
    
    let newStart = startBalanceIdr;
    if (isStarted && targetInv) {
      newStart = Math.max(0, startBalanceIdr - (targetInv.deposit || 0));
      setStartBalanceIdr(newStart);
    }
    triggerToast('Investor berhasil dihapus.');
    await syncInvestorsToServer(updated, newStart);
  };

  const handleProcessWithdrawal = async (e) => {
    e.preventDefault();
    if (!withdrawingInvestorCalc) return;
    
    const amount = parseFloat(withdrawAmountInput);
    if (isNaN(amount) || amount <= 0) {
      triggerToast('Jumlah penarikan tidak valid.', false);
      return;
    }
    
    if (amount > withdrawingInvestorCalc.currentValue) {
      triggerToast('Jumlah penarikan melebihi nilai bersih investor!', false);
      return;
    }

    const newPendingWithdrawal = {
      id: generateUniqueId(),
      amount,
      deltaDeposit: withdrawPreview.deltaDeposit,
      adminFeePaid: withdrawPreview.adminFeePaid,
      timestamp: Date.now()
    };

    const updated = investors.map(inv => {
      if (inv.id === withdrawingInvestorId) {
        const currentPending = Array.isArray(inv.pendingWithdrawals) ? inv.pendingWithdrawals : [];
        return {
          ...inv,
          pendingWithdrawals: [...currentPending, newPendingWithdrawal]
        };
      }
      return inv;
    });

    triggerToast(`Mengajukan penarikan Rp ${Math.round(amount).toLocaleString('id-ID')} (Pending)...`);
    setWithdrawingInvestorId(null);
    setWithdrawAmountInput('');

    await syncInvestorsToServer(updated, startBalanceIdr);
  };

  const handleConfirmWithdrawal = async (investorId, withdrawalId) => {
    const targetInvestor = investors.find(i => i.id === investorId);
    if (!targetInvestor) return;

    const targetWithdrawal = Array.isArray(targetInvestor.pendingWithdrawals)
      ? targetInvestor.pendingWithdrawals.find(w => w.id === withdrawalId)
      : null;
    
    if (!targetWithdrawal) return;

    const amount = targetWithdrawal.amount;
    const deltaDeposit = targetWithdrawal.deltaDeposit;

    triggerConfirm(
      'Konfirmasi Penarikan Sukses',
      `Apakah Anda yakin sudah mentransfer Rp ${Math.round(amount).toLocaleString('id-ID')} ke ${targetInvestor.name}? Modal investor akan dikurangi secara permanen.`,
      async () => {
        const updated = investors.map(inv => {
          if (inv.id === investorId) {
            const remainingPending = inv.pendingWithdrawals.filter(w => w.id !== withdrawalId);
            return {
              ...inv,
              deposit: Math.max(0, inv.deposit - deltaDeposit),
              pendingWithdrawals: remainingPending
            };
          }
          return inv;
        });

        let newStart = startBalanceIdr;
        if (isStarted) {
          newStart = Math.max(0, startBalanceIdr - deltaDeposit);
          setStartBalanceIdr(newStart);
        }

        if (!useExchangeApi) {
          const newManualBalance = Math.max(0, manualPoolBalanceIdr - amount);
          setManualPoolBalanceIdr(newManualBalance);
          setManualPoolBalanceInput(newManualBalance.toString());
          localStorage.setItem('invest_manual_pool_balance', newManualBalance.toString());

          if (isStarted) {
            try {
              const token = sessionStorage.getItem('admin_session_token') || adminToken;
              const todayLabel = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
              const res = await fetch('/api/pool/history', {
                method: 'POST',
                headers: { 
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ date: todayLabel, balance: newManualBalance })
              });
              const data = await res.json();
              if (data.success && data.hash) {
                setPoolHash(data.hash);
              }
            } catch (err) {
              console.error('Failed to update manual balance history point:', err);
            }
          }
        }

        triggerToast(`Penarikan ${targetInvestor.name} sebesar Rp ${Math.round(amount).toLocaleString('id-ID')} dikonfirmasi!`);
        await syncInvestorsToServer(updated, newStart);
      }
    );
  };

  const handleCancelWithdrawal = async (investorId, withdrawalId) => {
    const targetInvestor = investors.find(i => i.id === investorId);
    if (!targetInvestor) return;

    const targetWithdrawal = Array.isArray(targetInvestor.pendingWithdrawals)
      ? targetInvestor.pendingWithdrawals.find(w => w.id === withdrawalId)
      : null;
    
    if (!targetWithdrawal) return;

    const amount = targetWithdrawal.amount;

    triggerConfirm(
      'Batalkan Pengajuan Penarikan',
      `Apakah Anda yakin ingin membatalkan pengajuan penarikan Rp ${Math.round(amount).toLocaleString('id-ID')} untuk ${targetInvestor.name}?`,
      async () => {
        const updated = investors.map(inv => {
          if (inv.id === investorId) {
            const remainingPending = inv.pendingWithdrawals.filter(w => w.id !== withdrawalId);
            return {
              ...inv,
              pendingWithdrawals: remainingPending
            };
          }
          return inv;
        });

        triggerToast(`Pengajuan penarikan Rp ${Math.round(amount).toLocaleString('id-ID')} dibatalkan.`);
        await syncInvestorsToServer(updated, startBalanceIdr);
      }
    );
  };

  return (
    <div className="deck-perspective" style={{ animation: 'fadeIn 0.5s ease' }}>
      {/* Toast Notification */}
      {successMsg && (
        <div style={{
          position: 'fixed', top: '24px', right: '24px', zIndex: 10000,
          background: 'var(--bg-card)', border: '1px solid var(--color-lime)',
          color: '#fff', padding: '0.8rem 1.4rem', borderRadius: '30px',
          boxShadow: '0 4px 20px rgba(212, 255, 58, 0.15)',
          display: 'flex', alignItems: 'center', gap: '0.6rem',
          fontWeight: 600, animation: 'fadeIn 0.3s ease',
          backdropFilter: 'blur(8px)', fontFamily: 'var(--sans)',
        }}>
          <CheckCircle size={16} color="var(--color-lime)" /> {successMsg}
        </div>
      )}
      {errorMsg && (
        <div style={{
          position: 'fixed', top: '24px', right: '24px', zIndex: 10000,
          background: 'var(--bg-card)', border: '1px solid var(--color-crimson)',
          color: '#fff', padding: '0.8rem 1.4rem', borderRadius: '30px',
          boxShadow: '0 4px 20px rgba(255, 59, 48, 0.15)',
          display: 'flex', alignItems: 'center', gap: '0.6rem',
          fontWeight: 600, animation: 'fadeIn 0.3s ease',
          backdropFilter: 'blur(8px)', fontFamily: 'var(--sans)',
        }}>
          <AlertCircle size={16} color="var(--color-crimson)" /> {errorMsg}
        </div>
      )}

      <main ref={consoleRef} className="deck-console">
        
        {/* Navigation Bar */}
        <nav className="top-nav header-animate">
          <div className="nav-links" style={{ alignItems: 'center' }}>
            <span style={{ fontSize: '1.1rem', fontWeight: '800', color: '#fff', paddingLeft: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <TrendingUp size={20} color="var(--color-lime)" />
              Investment <span style={{ color: 'var(--color-lime)', fontWeight: '300' }}>Monitor</span>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.62rem',
              background: isDbConnected ? 'rgba(48, 209, 88, 0.08)' : 'rgba(255, 159, 10, 0.08)',
              color: isDbConnected ? '#30d158' : '#ff9f0a',
              border: `1px solid ${isDbConnected ? 'rgba(48, 209, 88, 0.15)' : 'rgba(255, 159, 10, 0.15)'}`,
              padding: '2px 8px',
              borderRadius: '12px',
              fontWeight: 600
            }} title={isDbConnected ? "Terhubung ke Supabase Cloud" : "Fallback ke Database Lokal /tmp (Sementara)"}>
              <span style={{
                width: '4px',
                height: '4px',
                borderRadius: '50%',
                background: isDbConnected ? '#30d158' : '#ff9f0a'
              }} />
              {isDbConnected ? 'Supabase' : 'Local Fallback'}
            </span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                RATE: Rp {Math.round(exchangeRate).toLocaleString('id-ID')}/USDT
              </span>
              <button
                onClick={() => fetchRates(false)}
                disabled={ratesLoading}
                title="Refresh Rate"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px', display: 'inline-flex', alignItems: 'center' }}
              >
                <RefreshCw size={13} className={ratesLoading ? 'spin-anim' : ''} />
              </button>
            </div>
            {isAdmin ? (
              <button
                className="btn-titan"
                onClick={handleAdminLogout}
                style={{ padding: '0.4rem 0.8rem', fontSize: '0.7rem', borderColor: 'var(--color-crimson)', color: 'var(--color-crimson)' }}
              >
                <LogOut size={13} /> Logout Admin
              </button>
            ) : (
              <button
                className="btn-titan"
                onClick={() => setIsLoginOpen(true)}
                style={{ padding: '0.4rem 0.8rem', fontSize: '0.7rem' }}
              >
                <Lock size={13} /> Login Admin
              </button>
            )}
            <div className="profile-circle">{isAdmin ? 'AD' : 'US'}</div>
          </div>
        </nav>

        {/* Title & Elapsed Duration Timer */}
        <header className="header-animate" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginTop: '0.5rem' }}>
          <div>
            <span className="label-muted" style={{ fontSize: '0.65rem' }}>
              {isAdmin ? 'ADMIN CONTROL CONSOLE' : 'INVESTOR SHARED MONITORING'}
            </span>
            <h1 style={{ marginTop: '0.2rem', fontSize: '2rem', fontWeight: '800' }}>
              Capital Pool Dashboard {isAdmin && <span style={{ color: 'var(--color-lime)', fontWeight: '300', fontSize: '1.2rem', marginLeft: '0.5rem' }}>(Admin Mode)</span>}
            </h1>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
            <span className="label-muted">DURASI BERJALAN SIKLUS</span>
            <div className="clock-deck">
              {[
                { val: elapsed.days, lbl: 'D' },
                { val: String(elapsed.hours).padStart(2, '0'), lbl: 'H' },
                { val: String(elapsed.minutes).padStart(2, '0'), lbl: 'M' },
                { val: String(elapsed.seconds).padStart(2, '0'), lbl: 'S' },
              ].map(({ val, lbl }) => (
                <div key={lbl} className="clock-slot">
                  <span className="clock-val">{val}</span>
                  <span className="clock-lbl">{lbl}</span>
                </div>
              ))}
            </div>
          </div>
        </header>

        {/* 3 KPI Cards Grid */}
        <section className="grid-3x card-animate">
          
          {/* Card 1: Total Equity Value */}
          <div className="reference-card">
            <div className="card-top">
              <span className="card-title">Total Equity Pool</span>
              {useExchangeApi && (
                <button
                  onClick={fetchExchangeDetails}
                  disabled={loading}
                  title="Sync API"
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
                >
                  <RefreshCw size={14} className={loading ? 'spin-anim' : ''} />
                </button>
              )}
            </div>
            <div>
              <div className="card-value">
                Rp {Math.round(currentBalanceIdr).toLocaleString('id-ID')}
              </div>
              <span className="card-subtext">
                Equiv: ${currentBalanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
              </span>
            </div>
          </div>

          {/* Card 2: ROI Keuntungan (Persenan Kenaikan) */}
          <div className={`reference-card ${totalGainPct >= 0 ? '' : 'crimson-border'}`}>
            <div className="card-top">
              <span className="card-title">Persenan Kenaikan (ROI)</span>
              <span className={`roi-badge ${totalGainPct >= 0 ? 'profit' : 'loss'}`}>
                {totalGainPct >= 0 ? '+' : ''}{totalGainPct.toFixed(2)}%
              </span>
            </div>
            <div>
              <div className="card-value" style={{ color: totalGainPct >= 0 ? 'var(--color-green-profit)' : 'var(--color-crimson)' }}>
                {totalProfitIdr >= 0 ? '+' : ''}Rp {Math.round(totalProfitIdr).toLocaleString('id-ID')}
              </div>
              <span className="card-subtext">
                Modal Awal Siklus: Rp {startingCapitalIdr.toLocaleString('id-ID')} | PnL: ${totalProfitUsd.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              </span>
            </div>
          </div>

          {/* Card 3: Start Cycle Capital */}
          <div className="reference-card lime-accent">
            <div className="card-top">
              <span className="card-title" style={{ color: 'rgba(0,0,0,0.6)' }}>Modal Awal Siklus</span>
              <Award size={18} color="rgba(0,0,0,0.6)" />
            </div>
            <div>
              <div className="card-value" style={{ color: '#000' }}>
                Rp {startingCapitalIdr.toLocaleString('id-ID')}
              </div>
              <span className="card-subtext" style={{ color: 'rgba(0,0,0,0.6)', fontWeight: 600 }}>
                Status: {isStarted ? 'SIKLUS AKTIF' : 'RESET / SIAP DIMULAI'}
              </span>
            </div>
          </div>

        </section>

        {/* Main Dashboard Layout */}
        <div className="grid-asymmetric card-animate">
          
          {/* Left Column: Growth Chart */}
          <section className="obsidian-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '0.85rem' }}>Growth Trajectory Log</h2>
                <span className="label-muted" style={{ fontSize: '0.65rem' }}>Dana Akumulatif Modal & Profit</span>
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.03)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                {useExchangeApi ? 'API Synced' : 'Manual Input Mode'}
              </span>
            </div>
            
            <ProgressionChart chartData={chartData} />
          </section>

          {/* Right Column: Investor shares list + Admin Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            
            {/* Investor Capital Shares Table */}
            <section className="obsidian-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ fontSize: '0.85rem' }}>Investor Capital Shares</h2>
                  <span className="label-muted" style={{ fontSize: '0.65rem' }}>Pembagian Hasil Investor (Net)</span>
                </div>
                {isAdmin && (
                  <button
                    className="btn-titan"
                    onClick={() => setIsManageInvestorsOpen(true)}
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.7rem' }}
                  >
                    <Users size={12} /> Manage
                  </button>
                )}
              </div>

              {/* Desktop View */}
              <div className="desktop-only" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.74rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '0.4rem 0.25rem' }}>Nama</th>
                      <th style={{ padding: '0.4rem 0.25rem', textAlign: 'right' }}>Porsi Modal</th>
                      <th style={{ padding: '0.4rem 0.25rem', textAlign: 'right' }}>Bagi Profit (Kotor/Net)</th>
                      <th style={{ padding: '0.4rem 0.25rem', textAlign: 'right' }}>Nilai Bersih</th>
                    </tr>
                  </thead>
                  <tbody>
                    {investorCalculations.map(inv => {
                      const isProfitShare = inv.netProfitShare >= 0;
                      return (
                        <tr key={inv.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                          <td style={{ padding: '0.6rem 0.25rem', fontWeight: 600, color: '#fff' }}>
                            <div className="td-wrapper">
                              <div>{inv.name}</div>
                              <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)' }}>Gabung: {inv.joinDate || '2026-06-01'}</div>
                              {inv.pendingNet > 0 && (
                                <div style={{ fontSize: '0.6rem', color: 'var(--color-lavender)', background: 'rgba(184, 155, 251, 0.08)', border: '1px solid rgba(184, 155, 251, 0.15)', padding: '1px 6px', borderRadius: '4px', display: 'inline-block', marginTop: '4px', width: 'fit-content', fontFamily: 'var(--mono)' }}>
                                  Pending WD: Rp {inv.pendingNet.toLocaleString('id-ID')}
                                </div>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '0.6rem 0.25rem', textAlign: 'right' }}>
                            <div className="td-wrapper">
                              <div style={{ fontWeight: 700 }}>{inv.sharePct.toFixed(1)}%</div>
                              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
                                Rp {Math.round(inv.deposit).toLocaleString('id-ID')}
                              </div>
                              <div style={{ fontSize: '0.58rem', color: 'var(--text-secondary)', fontFamily: 'var(--mono)' }}>
                                {(inv.deposit / exchangeRate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '0.6rem 0.25rem', textAlign: 'right' }}>
                            <div className="td-wrapper">
                              <div style={{ fontWeight: 700, color: isProfitShare ? 'var(--color-green-profit)' : 'var(--color-crimson)' }}>
                                {isProfitShare ? '+' : ''}Rp {Math.round(inv.netProfitShare).toLocaleString('id-ID')}
                              </div>
                              <div style={{ fontSize: '0.58rem', color: isProfitShare ? 'var(--color-green-profit)' : 'var(--color-crimson)', fontFamily: 'var(--mono)', opacity: 0.85 }}>
                                {isProfitShare ? '+' : ''}${(inv.netProfitShare / exchangeRate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                              </div>
                              <div style={{ fontSize: '0.55rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                Kotor: {isProfitShare ? '+' : ''}Rp {Math.round(inv.grossProfitShare).toLocaleString('id-ID')} | Fee: {inv.adminFeePct || 20}%
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '0.6rem 0.25rem', textAlign: 'right', fontWeight: 600 }}>
                            <div className="td-wrapper">
                              <div>Rp {Math.round(inv.currentValue).toLocaleString('id-ID')}</div>
                              <div style={{ fontSize: '0.62rem', color: 'var(--color-lime)', fontFamily: 'var(--mono)' }}>
                                {(inv.currentValue / exchangeRate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile View */}
              <div className="mobile-only">
                <div className="mobile-investor-cards">
                  {investorCalculations.map(inv => {
                    const isProfitShare = inv.netProfitShare >= 0;
                    return (
                      <div key={inv.id} className="mobile-investor-card">
                        <div className="card-header">
                          <div className="investor-info">
                            <span className="investor-name">{inv.name}</span>
                            <span className="investor-date">Gabung: {inv.joinDate || '2026-06-01'}</span>
                            {inv.pendingNet > 0 && (
                              <span style={{ fontSize: '0.6rem', color: 'var(--color-lavender)', background: 'rgba(184, 155, 251, 0.08)', border: '1px solid rgba(184, 155, 251, 0.15)', padding: '1px 6px', borderRadius: '4px', display: 'inline-block', marginTop: '4px', width: 'fit-content', fontFamily: 'var(--mono)' }}>
                                Pending WD: Rp {inv.pendingNet.toLocaleString('id-ID')}
                              </span>
                            )}
                          </div>
                          <span className="investor-badge-share">
                            {inv.sharePct.toFixed(1)}% Share
                          </span>
                        </div>
                        
                        <div className="card-body">
                          <div className="info-row">
                            <span className="info-label">Porsi Modal</span>
                            <span className="info-val" style={{ textAlign: 'right' }}>
                              <div>Rp {Math.round(inv.deposit).toLocaleString('id-ID')}</div>
                              <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', fontFamily: 'var(--mono)' }}>
                                {(inv.deposit / exchangeRate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                              </div>
                            </span>
                          </div>
                          
                          <div className="info-row">
                            <span className="info-label">Bagi Profit (Net)</span>
                            <span className={`info-val ${isProfitShare ? 'text-profit' : 'text-loss'}`} style={{ textAlign: 'right' }}>
                              <div>{isProfitShare ? '+' : ''}Rp {Math.round(inv.netProfitShare).toLocaleString('id-ID')}</div>
                              <div style={{ fontSize: '0.62rem', fontFamily: 'var(--mono)' }}>
                                {isProfitShare ? '+' : ''}${(inv.netProfitShare / exchangeRate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                              </div>
                            </span>
                          </div>
                          
                          <div className="fee-details-row">
                            <div className="fee-item">
                              <span>Profit Kotor</span>
                              <span className="fee-val">{isProfitShare ? '+' : ''}Rp {Math.round(inv.grossProfitShare).toLocaleString('id-ID')}</span>
                            </div>
                            <div className="fee-item">
                              <span>Fee Admin ({inv.adminFeePct || 20}%)</span>
                              <span className="fee-val" style={{ color: inv.adminFee > 0 ? 'var(--color-crimson)' : 'var(--text-secondary)' }}>
                                {inv.adminFee > 0 ? '-' : ''}Rp {Math.round(inv.adminFee).toLocaleString('id-ID')}
                              </span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="card-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className="footer-label">Nilai Bersih</span>
                          <div style={{ textAlign: 'right' }}>
                            <span className="footer-val" style={{ display: 'block' }}>
                              Rp {Math.round(inv.currentValue).toLocaleString('id-ID')}
                            </span>
                            <span style={{ fontSize: '0.72rem', color: 'var(--color-lime)', fontWeight: 700, fontFamily: 'var(--mono)' }}>
                              {(inv.currentValue / exchangeRate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Cycle Control Center (Admin-only) */}
            {isAdmin && (
              <section className="obsidian-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div>
                  <h2 style={{ fontSize: '0.85rem' }}>Cycle Control Center</h2>
                  <span className="label-muted" style={{ fontSize: '0.65rem' }}>Panel Kontrol Siklus Admin</span>
                </div>

                {isStarted && (
                  <div style={{ padding: '0.75rem 1rem', background: 'rgba(212, 255, 58, 0.04)', border: '1px solid rgba(212, 255, 58, 0.1)', borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <span className="label-muted" style={{ fontSize: '0.58rem', color: 'var(--color-lime)' }}>Akumulasi Fee Admin Siklus Ini</span>
                    <span style={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: 'var(--mono)', color: '#fff' }}>
                      Rp {Math.round(totalAdminFeeIdr).toLocaleString('id-ID')}
                    </span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontFamily: 'var(--mono)' }}>
                      Equivalent: ${(totalAdminFeeIdr / exchangeRate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                    </span>
                  </div>
                )}

                {isStarted && allPendingWithdrawals.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.2rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.75rem' }}>
                    <span className="label-muted" style={{ fontSize: '0.58rem', color: 'var(--color-lavender)' }}>Antrean Penarikan (Pending WD)</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '180px', overflowY: 'auto', paddingRight: '2px' }}>
                      {allPendingWithdrawals.map(w => (
                        <div key={w.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', padding: '0.65rem 0.8rem', borderRadius: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.76rem', color: '#fff' }}>{w.investorName}</span>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.76rem', color: 'var(--color-lime)', fontWeight: 700 }}>
                              Rp {Math.round(w.amount).toLocaleString('id-ID')}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: 'var(--text-secondary)' }}>
                            <span>Potong Pokok: Rp {w.deltaDeposit.toLocaleString('id-ID')}</span>
                            <span>Fee: Rp {w.adminFeePaid.toLocaleString('id-ID')}</span>
                          </div>
                          <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.2rem' }}>
                            <button
                              type="button"
                              onClick={() => handleConfirmWithdrawal(w.investorId, w.id)}
                              className="btn-gold"
                              style={{ flex: 1, padding: '0.25rem 0.5rem', fontSize: '0.62rem', height: 'auto', borderRadius: '8px' }}
                            >
                              Konfirmasi Transfer
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCancelWithdrawal(w.investorId, w.id)}
                              className="btn-danger-titan"
                              style={{ flex: 0.4, padding: '0.25rem 0.5rem', fontSize: '0.62rem', height: 'auto', borderRadius: '8px' }}
                            >
                              Batal
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.2rem' }}>
                  <button
                    onClick={handleStartCycle}
                    disabled={isStarted}
                    className="btn-gold"
                    style={{ flex: 1, opacity: isStarted ? 0.4 : 1, cursor: isStarted ? 'not-allowed' : 'pointer' }}
                  >
                    Start Cycle
                  </button>
                  <button
                    onClick={handleResetCycle}
                    disabled={!isStarted}
                    className="btn-danger-titan"
                    style={{ flex: 1, opacity: !isStarted ? 0.4 : 1, cursor: !isStarted ? 'not-allowed' : 'pointer' }}
                  >
                    Reset Cycle
                  </button>
                </div>
              </section>
            )}

            {/* Guide Book (Admin-only) */}
            {isAdmin && (
              <section className="obsidian-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setIsGuideOpen(!isGuideOpen)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--color-lime)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '0.2rem 0',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    textAlign: 'left'
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    📖 Admin Guide Book & SOP
                  </span>
                  <span>{isGuideOpen ? '▲' : '▼'}</span>
                </button>
                
                {isGuideOpen && (
                  <div style={{
                    fontSize: '0.72rem',
                    color: 'var(--text-secondary)',
                    lineHeight: '1.45',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.85rem',
                    marginTop: '0.5rem',
                    borderTop: '1px solid rgba(255,255,255,0.05)',
                    paddingTop: '0.75rem'
                  }}>
                    <div>
                      <h4 style={{ color: '#fff', fontSize: '0.76rem', marginBottom: '0.25rem', fontWeight: 700 }}>
                        📥 1. Tambah Investor & Top-Up (Tengah Siklus)
                      </h4>
                      <ol style={{ paddingLeft: '1rem', margin: 0 }}>
                        <li>Lakukan deposit uang fisik ke akun Bybit (atau update saldo manual).</li>
                        <li>Tunggu sampai saldo Bybit bertambah di dashboard.</li>
                        <li>Buka <strong>Manage Investors</strong> dan isi nominal dana fisik asli yang masuk.</li>
                        <li>Pastikan opsi <strong>"Sesuaikan Modal Otomatis"</strong> dicentang agar ROI tidak terganggu.</li>
                        <li>Sistem akan mencatat deposit virtual yang disesuaikan (lebih kecil saat profit, lebih besar saat rugi) agar adil bagi investor lama, sementara nilai bersih awal investor baru tetap pas sesuai dana fisiknya.</li>
                      </ol>
                    </div>

                    <div>
                      <h4 style={{ color: '#fff', fontSize: '0.76rem', marginBottom: '0.25rem', fontWeight: 700 }}>
                        📤 2. Penarikan Dana Sebagian / Seluruh (Withdrawal)
                      </h4>
                      <ol style={{ paddingLeft: '1rem', margin: 0 }}>
                        <li>Buka <strong>Manage Investors</strong> &rarr; klik <strong>Tarik</strong> pada nama investor &rarr; masukkan jumlah bersih &rarr; klik <strong>Proses</strong>. Status berubah jadi <code>Pending WD</code>.</li>
                        <li>Tarik/transfer uang fisik senilai nominal bersih tersebut secara manual dari Bybit ke rekening investor.</li>
                        <li>Setelah transfer fisik sukses, buka <strong>Cycle Control Center</strong> &rarr; klik <strong>"Konfirmasi Transfer"</strong> pada antrean pending. Sistem akan memotong modal pokok secara permanen.</li>
                      </ol>
                    </div>

                    <div>
                      <h4 style={{ color: '#fff', fontSize: '0.76rem', marginBottom: '0.25rem', fontWeight: 700 }}>
                        🔄 3. Mengakhiri & Gulung Siklus (Reset Cycle)
                      </h4>
                      <ol style={{ paddingLeft: '1rem', margin: 0 }}>
                        <li>Pastikan antrean <code>Pending WD</code> kosong (konfirmasi/batalkan semuanya).</li>
                        <li>Pada <strong>Cycle Control Center</strong>, klik <strong>Reset Cycle</strong>.</li>
                        <li>Sistem akan menghentikan siklus berjalan, menghitung bagi hasil bersih, dan menggulung Nilai Bersih saat ini menjadi modal deposit baru untuk siklus berikutnya (Auto-Compounding).</li>
                      </ol>
                    </div>
                  </div>
                )}
              </section>
            )}

          </div>
        </div>

        {/* ── Admin Login Dialog ──────────────────────────────────────────────── */}
        {isLoginOpen && (
          <div className="dialog-overlay">
            <form className="dialog-content" onSubmit={handleAdminLogin} style={{ maxWidth: '380px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Lock size={18} color="var(--color-lime)" /> Login Administrator
                </h2>
                <button type="button" className="btn-titan" style={{ padding: '0.3rem 0.6rem' }} onClick={() => setIsLoginOpen(false)}>✕</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <label className="label-muted" style={{ fontSize: '0.65rem' }}>Password Admin</label>
                <input
                  type="password"
                  placeholder="Masukkan password admin"
                  value={adminPasswordInput}
                  onChange={(e) => setAdminPasswordInput(e.target.value)}
                  className="input-titan"
                  required
                  autoFocus
                />
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="submit" className="btn-gold" style={{ flex: 1 }}>Authenticate</button>
                <button type="button" className="btn-titan" onClick={() => setIsLoginOpen(false)}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        {/* ── Manage Investors Dialog (Admin-only) ────────────────────────────────────────────── */}
        {isManageInvestorsOpen && (
          <div className="dialog-overlay">
            <div className="dialog-content" style={{ maxWidth: '580px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 800 }}>Manage Investors Pool</h2>
                <button type="button" className="btn-titan" style={{ padding: '0.3rem 0.6rem' }} onClick={() => { setIsManageInvestorsOpen(false); handleCancelEdit(); }}>✕</button>
              </div>

              {/* Add/Edit Investor Form */}
              <form onSubmit={handleSaveInvestor} style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '1rem' }}>
                <span className="label-muted" style={{ fontSize: '0.55rem' }}>
                  {editingInvestorId ? 'Edit Data Investor' : 'Tambah Investor Baru'}
                </span>
                <div className="form-grid-add-investor">
                  <input
                    type="text"
                    placeholder="Nama"
                    value={newInvName}
                    onChange={(e) => setNewInvName(e.target.value)}
                    className="input-titan"
                    required
                  />
                  <input
                    type="number"
                    placeholder="Modal Rp"
                    value={newInvDeposit}
                    onChange={(e) => setNewInvDeposit(e.target.value)}
                    className="input-titan"
                    required
                  />
                  <input
                    type="number"
                    placeholder="Fee %"
                    value={newInvAdminFeePct}
                    onChange={(e) => setNewInvAdminFeePct(e.target.value)}
                    className="input-titan"
                    required
                  />
                  <input
                    type="date"
                    value={newInvJoinDate}
                    onChange={(e) => setNewInvJoinDate(e.target.value)}
                    className="input-titan"
                    required
                  />
                </div>
                
                {/* Penyesuaian Modal Tengah Siklus */}
                {isStarted && startingCapitalIdr > 0 && currentBalanceIdr > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.2rem', padding: '0.6rem 0.85rem', background: 'rgba(212, 255, 58, 0.04)', border: '1px dashed rgba(212, 255, 58, 0.15)', borderRadius: '16px', textAlign: 'left' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--color-lime)', cursor: 'pointer', fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        checked={autoAdjustMidCycle}
                        onChange={(e) => setAutoAdjustMidCycle(e.target.checked)}
                        style={{ accentColor: 'var(--color-lime)', cursor: 'pointer' }}
                      />
                      Sesuaikan Modal Otomatis (Masuk Tengah Siklus)
                    </label>
                    {autoAdjustMidCycle && parseFloat(newInvDeposit) > 0 && (
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                        Porsi modal diakui di sistem: <strong style={{ color: 'var(--color-lime)', fontFamily: 'var(--mono)' }}>Rp {adjustedDepositPreview.toLocaleString('id-ID')}</strong> (Uang riil ditransfer tetap <strong>Rp {parseFloat(newInvDeposit).toLocaleString('id-ID')}</strong> agar adil bagi investor lama).
                      </span>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.2rem' }}>
                  {editingInvestorId && (
                    <button type="button" className="btn-titan" style={{ padding: '0.5rem 1.25rem' }} onClick={handleCancelEdit} disabled={loading}>
                      Batal
                    </button>
                  )}
                  <button type="submit" className="btn-gold" style={{ padding: '0.5rem 1.25rem' }} disabled={loading}>
                    {loading ? 'Menyimpan...' : (editingInvestorId ? 'Simpan Perubahan' : <><Plus size={14} /> Tambah Investor</>)}
                  </button>
                </div>
              </form>

              {/* Investors List for Management */}
              <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                <span className="label-muted" style={{ fontSize: '0.55rem', display: 'block', marginBottom: '0.2rem' }}>Daftar Patungan Aktif</span>
                {investors.map(inv => (
                  <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1c1e27', padding: '0.6rem 0.85rem', borderRadius: '16px' }}>
                    <div>
                      <div style={{ fontWeight: 600, color: '#fff', fontSize: '0.85rem' }}>{inv.name}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                        Modal: Rp {inv.deposit.toLocaleString('id-ID')} | Fee: {inv.adminFeePct || 20}% | Gabung: {inv.joinDate || '2026-06-01'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      {isStarted && (
                        <button
                          onClick={() => {
                            setWithdrawingInvestorId(inv.id);
                            setWithdrawAmountInput('');
                          }}
                          className="btn-gold"
                          style={{ padding: '0.35rem 0.75rem', fontSize: '0.7rem' }}
                        >
                          Tarik
                        </button>
                      )}
                      <button
                        onClick={() => handleStartEditInvestor(inv)}
                        className="btn-titan"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.7rem' }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteInvestor(inv.id)}
                        className="btn-danger-titan"
                        style={{ padding: '0.35rem 0.75rem' }}
                      >
                        <Trash2 size={12} /> Hapus
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Reset Everything Buttons */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={handleResetAllData}
                  className="btn-danger-titan"
                  style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                >
                  <RefreshCw size={12} /> Reset Console (Default)
                </button>
                <button type="button" className="btn-titan" onClick={() => { setIsManageInvestorsOpen(false); handleCancelEdit(); }}>Done</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Withdraw Capital Dialog (Admin-only) ────────────────────────────────────────────── */}
        {withdrawingInvestorId && withdrawingInvestorCalc && (
          <div className="dialog-overlay" style={{ zIndex: 1100 }}>
            <form className="dialog-content" onSubmit={handleProcessWithdrawal} style={{ maxWidth: '420px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--color-lime)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  Tarik Dana Investor
                </h2>
                <button type="button" className="btn-titan" style={{ padding: '0.3rem 0.6rem' }} onClick={() => { setWithdrawingInvestorId(null); setWithdrawAmountInput(''); }}>✕</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.8rem 1rem', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>Investor</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#fff', marginTop: '0.15rem' }}>{withdrawingInvestorCalc.name}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.6rem', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '0.6rem' }}>
                    <div>
                      <span className="label-muted" style={{ fontSize: '0.58rem' }}>Modal Pokok</span>
                      <div style={{ fontSize: '0.8rem', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text-secondary)' }}>Rp {Math.round(withdrawingInvestorCalc.deposit).toLocaleString('id-ID')}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className="label-muted" style={{ fontSize: '0.58rem', color: 'var(--color-lime)' }}>Nilai Bersih Saat Ini</span>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--color-lime)' }}>Rp {Math.round(withdrawingInvestorCalc.currentValue).toLocaleString('id-ID')}</div>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <label className="label-muted" style={{ fontSize: '0.65rem' }}>Jumlah Penarikan Bersih (Rp)</label>
                  <input
                    type="number"
                    placeholder={`Maks Rp ${Math.round(withdrawingInvestorCalc.currentValue).toLocaleString('id-ID')}`}
                    value={withdrawAmountInput}
                    onChange={(e) => setWithdrawAmountInput(e.target.value)}
                    className="input-titan"
                    required
                    autoFocus
                    max={Math.round(withdrawingInvestorCalc.currentValue)}
                    min="1"
                  />
                </div>

                {parseFloat(withdrawAmountInput) > 0 && parseFloat(withdrawAmountInput) <= withdrawingInvestorCalc.currentValue && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'rgba(212, 255, 58, 0.03)', border: '1px dashed rgba(212, 255, 58, 0.15)', padding: '0.85rem 1rem', borderRadius: '16px', fontSize: '0.74rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Uang Bersih Diterima:</span>
                      <strong style={{ color: '#fff', fontFamily: 'var(--mono)' }}>Rp {parseFloat(withdrawAmountInput).toLocaleString('id-ID')}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Pengurangan Modal Pokok:</span>
                      <strong style={{ color: 'var(--color-crimson)', fontFamily: 'var(--mono)' }}>-Rp {withdrawPreview.deltaDeposit.toLocaleString('id-ID')}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Biaya Admin Realisasi ({withdrawingInvestorCalc.adminFeePct || 20}%):</span>
                      <strong style={{ color: 'var(--color-lavender)', fontFamily: 'var(--mono)' }}>Rp {withdrawPreview.adminFeePaid.toLocaleString('id-ID')}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.4rem', marginTop: '0.1rem' }}>
                      <span style={{ color: 'var(--color-lime)', fontWeight: 600 }}>Sisa Nilai Bersih:</span>
                      <strong style={{ color: 'var(--color-lime)', fontFamily: 'var(--mono)' }}>Rp {withdrawPreview.previewRemainingNet.toLocaleString('id-ID')}</strong>
                    </div>
                  </div>
                )}

                {parseFloat(withdrawAmountInput) > withdrawingInvestorCalc.currentValue && (
                  <div style={{ color: 'var(--color-crimson)', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255, 59, 48, 0.05)', border: '1px solid rgba(255, 59, 48, 0.15)', padding: '0.5rem 0.75rem', borderRadius: '12px' }}>
                    <AlertCircle size={14} /> Nominal penarikan melebihi saldo bersih investor!
                  </div>
                )}

                <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', lineHeight: 1.4, opacity: 0.85 }}>
                  {useExchangeApi ? (
                    <span>⚠️ <strong>PENTING:</strong> Sistem hanya mengupdate pencatatan porsi modal. Anda harus mentransfer/menarik uang sebesar <strong>Rp {parseFloat(withdrawAmountInput || 0).toLocaleString('id-ID')}</strong> secara fisik dari akun Bybit agar sinkronisasi saldo tetap akurat.</span>
                  ) : (
                    <span>ℹ️ Saldo manual pool akan dikurangi sebesar <strong>Rp {parseFloat(withdrawAmountInput || 0).toLocaleString('id-ID')}</strong> secara otomatis setelah penarikan disetujui.</span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  type="submit"
                  className="btn-gold"
                  style={{ flex: 1 }}
                  disabled={loading || !withdrawAmountInput || parseFloat(withdrawAmountInput) <= 0 || parseFloat(withdrawAmountInput) > withdrawingInvestorCalc.currentValue}
                >
                  {loading ? 'Memproses...' : 'Proses Penarikan'}
                </button>
                <button type="button" className="btn-titan" style={{ flex: 1 }} onClick={() => { setWithdrawingInvestorId(null); setWithdrawAmountInput(''); }} disabled={loading}>Batal</button>
              </div>
            </form>
          </div>
        )}

        {/* ── Custom Confirmation Dialog ────────────────────────────────────────── */}
        {confirmConfig.isOpen && (
          <div className="dialog-overlay" style={{ zIndex: 1100 }}>
            <div className="dialog-content" style={{ maxWidth: '380px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--color-lime)' }}>
                  {confirmConfig.title}
                </h2>
                <button type="button" className="btn-titan" style={{ padding: '0.3rem 0.6rem' }} onClick={closeConfirm}>✕</button>
              </div>

              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: '0.2rem' }}>
                {confirmConfig.message}
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="button" className="btn-gold" style={{ flex: 1 }} onClick={confirmConfig.onConfirm}>Confirm</button>
                <button type="button" className="btn-titan" style={{ flex: 1 }} onClick={closeConfirm}>Cancel</button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
