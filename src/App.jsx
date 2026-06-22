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

export default function App() {
  // App States
  const [loading, setLoading] = useState(false);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [exchangeRate, setExchangeRate] = useState(16400);
  
  // API Keys state (Server locked vs Local storage)
  const [isLockedByServer, setIsLockedByServer] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('exchange_api_key_local') || '');
  const [apiSecret, setApiSecret] = useState(() => localStorage.getItem('exchange_api_secret_local') || '');
  const [useExchangeApi, setUseExchangeApi] = useState(true);
  
  // Live balance from Exchange API
  const [apiBalanceUsd, setApiBalanceUsd] = useState(0);
  
  // Cycle state from Server pool.json
  const [isStarted, setIsStarted] = useState(false);
  const [startBalanceIdr, setStartBalanceIdr] = useState(8200000);
  const [investors, setInvestors] = useState([]);
  const [chartHistory, setChartHistory] = useState([]);
  const [cycleStartTime, setCycleStartTime] = useState(null);

  // Authentication state
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem('admin_session_token') || '');
  
  // Modals
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isManageInvestorsOpen, setIsManageInvestorsOpen] = useState(false);
  
  // Forms
  const [newInvName, setNewInvName] = useState('');
  const [newInvDeposit, setNewInvDeposit] = useState('');
  const [newInvJoinDate, setNewInvJoinDate] = useState(() => new Date().toISOString().substring(0, 10));
  const [newInvAdminFeePct, setNewInvAdminFeePct] = useState('20');
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  
  // Manual Pool Balance (If not using API Sync)
  const [manualPoolBalanceIdr, setManualPoolBalanceIdr] = useState(() => 
    parseFloat(localStorage.getItem('invest_manual_pool_balance') || '8200000')
  );
  const [manualPoolBalanceInput, setManualPoolBalanceInput] = useState(() => 
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
  }, []);

  // Fetch Exchange details
  const fetchExchangeDetails = async () => {
    setLoading(true);
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
        triggerToast('Sinkronisasi data API berhasil!');
      } else {
        triggerToast(data.error || 'Autentikasi API ditolak.', false);
      }
    } catch (err) {
      console.error('API fetch failed:', err);
      triggerToast('Koneksi backend proxy gagal.', false);
    } finally {
      setLoading(false);
    }
  };

  // Sync automatically if using Exchange API keys
  useEffect(() => {
    if (useExchangeApi && (isLockedByServer || (apiKey && apiSecret))) {
      fetchExchangeDetails();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useExchangeApi, isLockedByServer]);

  // Current Live balance in IDR
  const currentBalanceIdr = useMemo(() => {
    if (useExchangeApi) {
      return apiBalanceUsd * exchangeRate;
    }
    return manualPoolBalanceIdr;
  }, [useExchangeApi, apiBalanceUsd, exchangeRate, manualPoolBalanceIdr]);

  const currentBalanceUsd = currentBalanceIdr / exchangeRate;

  // Determine baseline starting capital (sum of investor deposits if Reset, or locked start balance if Started)
  const startingCapitalIdr = useMemo(() => {
    if (isStarted) return startBalanceIdr;
    return investors.reduce((sum, inv) => sum + parseFloat(inv.deposit || 0), 0);
  }, [isStarted, startBalanceIdr, investors]);

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

  // Share and Net Profit splits calculations
  const investorCalculations = useMemo(() => {
    const totalDeposits = investors.reduce((sum, inv) => sum + parseFloat(inv.deposit || 0), 0);
    
    return investors.map(inv => {
      const deposit = parseFloat(inv.deposit || 0);
      const sharePct = totalDeposits > 0 ? (deposit / totalDeposits) * 100 : 0;
      
      // Gross Profit share
      const grossProfitShare = isStarted ? (sharePct / 100) * totalProfitIdr : 0;
      
      // Admin Fee (defaults to 20% if not set)
      const feePct = parseFloat(inv.adminFeePct !== undefined ? inv.adminFeePct : 20);
      const adminFee = grossProfitShare > 0 ? grossProfitShare * (feePct / 100) : 0;
      
      // Net Profit share
      const netProfitShare = grossProfitShare - adminFee;
      const currentValue = deposit + netProfitShare;
      
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

  // Snapshot active balance to server history
  const handleUpdateManualBalance = async (newVal) => {
    setManualPoolBalanceIdr(newVal);
    setManualPoolBalanceInput(newVal.toString());
    localStorage.setItem('invest_manual_pool_balance', newVal.toString());

    if (isStarted) {
      try {
        const todayLabel = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
        await fetch('/api/pool/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: todayLabel, balance: newVal })
        });
        await fetchPoolState();
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Automated daily sync for history data point
  useEffect(() => {
    if (isStarted && currentBalanceIdr > 0) {
      const todayLabel = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
      const lastPoint = chartHistory[chartHistory.length - 1];
      if (!lastPoint || lastPoint.date !== todayLabel || Math.abs(lastPoint.balance - currentBalanceIdr) > 100) {
        fetch('/api/pool/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: todayLabel, balance: currentBalanceIdr })
        }).then(() => fetchPoolState()).catch(err => console.error(err));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBalanceIdr, isStarted]);

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
  const winRateMetrics = useMemo(() => {
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
  const syncInvestorsToServer = async (updatedList) => {
    try {
      const token = sessionStorage.getItem('admin_session_token') || adminToken;
      const res = await fetch('/api/pool/investors', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ investors: updatedList })
      });
      const data = await res.json();
      if (data.success) {
        await fetchPoolState();
      } else {
        triggerToast(data.error || 'Gagal menyimpan perubahan ke server.', false);
      }
    } catch (err) {
      console.error(err);
      triggerToast('Koneksi server gagal saat sinkronisasi.', false);
    }
  };

  // Start Cycle Action
  const handleStartCycle = async () => {
    if (isStarted) return;
    if (startingCapitalIdr <= 0) {
      triggerToast('Total modal awal investor harus lebih besar dari Rp 0!', false);
      return;
    }
    if (!window.confirm(`Mulai siklus baru dengan Modal Awal Rp ${startingCapitalIdr.toLocaleString('id-ID')}?`)) return;

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
  };

  // Reset Cycle Action (compounds net value and stops the cycle)
  const handleResetCycle = async () => {
    if (!isStarted) return;
    if (!window.confirm('Reset siklus saat ini? Tindakan ini akan membagikan profit bersih ke modal investor (compounding) dan mengunci profit berjalan.')) return;

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
          currentBalanceIdr
        })
      });
      const data = await res.json();
      if (data.success) {
        await fetchPoolState();
        triggerToast('Siklus investasi dihentikan & profit berhasil digulung!');
      } else {
        triggerToast(data.error || 'Gagal mereset siklus.', false);
      }
    } catch (err) {
      console.error(err);
      triggerToast('Gagal terhubung ke server.', false);
    }
  };

  // Toggle Data Source
  const handleToggleDataSource = (val) => {
    setUseExchangeApi(val);
    localStorage.setItem('invest_use_exchange_api', val.toString());
    triggerToast(val ? 'Sumber data dialihkan ke API Sync.' : 'Sumber data dialihkan ke Input Manual.');
  };

  // Reset console to defaults
  const handleResetAllData = async () => {
    if (!window.confirm('Apakah Anda yakin ingin mereset konsol ke setelan awal pabrik?')) return;
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
  };

  // Add/Remove Investors
  const handleAddInvestor = async (e) => {
    e.preventDefault();
    if (!newInvName.trim() || !newInvDeposit || isNaN(newInvDeposit) || parseFloat(newInvDeposit) <= 0 || !newInvJoinDate || isNaN(newInvAdminFeePct)) {
      triggerToast('Data form investor tidak valid!', false);
      return;
    }

    const newInv = {
      id: Math.random().toString(),
      name: newInvName.trim(),
      deposit: parseFloat(newInvDeposit),
      joinDate: newInvJoinDate,
      adminFeePct: parseFloat(newInvAdminFeePct)
    };

    const updated = [...investors, newInv];
    setInvestors(updated);
    setNewInvName('');
    setNewInvDeposit('');
    setNewInvAdminFeePct('20');
    setNewInvJoinDate(new Date().toISOString().substring(0, 10));
    triggerToast('Investor baru ditambahkan!');
    await syncInvestorsToServer(updated);
  };

  const handleDeleteInvestor = async (id) => {
    if (investors.length <= 1) {
      triggerToast('Minimal harus menyisakan 1 investor!', false);
      return;
    }
    const updated = investors.filter(i => i.id !== id);
    setInvestors(updated);
    triggerToast('Investor berhasil dihapus.');
    await syncInvestorsToServer(updated);
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              RATE: Rp {Math.round(exchangeRate).toLocaleString('id-ID')}/USDT
            </span>
            <button
              onClick={() => fetchRates(false)}
              disabled={ratesLoading}
              title="Refresh Rate"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}
            >
              <RefreshCw size={13} className={ratesLoading ? 'spin-anim' : ''} />
            </button>
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
                {isAdmin && !isStarted && (
                  <button
                    className="btn-titan"
                    onClick={() => setIsManageInvestorsOpen(true)}
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.7rem' }}
                  >
                    <Users size={12} /> Manage
                  </button>
                )}
              </div>

              <div style={{ overflowX: 'auto' }}>
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
                            </div>
                          </td>
                          <td style={{ padding: '0.6rem 0.25rem', textAlign: 'right' }}>
                            <div className="td-wrapper">
                              <div style={{ fontWeight: 700 }}>{inv.sharePct.toFixed(1)}%</div>
                              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>Rp {Math.round(inv.deposit).toLocaleString('id-ID')}</div>
                            </div>
                          </td>
                          <td style={{ padding: '0.6rem 0.25rem', textAlign: 'right' }}>
                            <div className="td-wrapper">
                              <div style={{ fontWeight: 700, color: isProfitShare ? 'var(--color-green-profit)' : 'var(--color-crimson)' }}>
                                {isProfitShare ? '+' : ''}Rp {Math.round(inv.netProfitShare).toLocaleString('id-ID')}
                              </div>
                              <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)' }}>
                                Kotor: {isProfitShare ? '+' : ''}Rp {Math.round(inv.grossProfitShare).toLocaleString('id-ID')} | Fee: {inv.adminFeePct || 20}% (-Rp {Math.round(inv.adminFee).toLocaleString('id-ID')})
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '0.6rem 0.25rem', textAlign: 'right', fontWeight: 600 }}>
                            <div className="td-wrapper">
                              Rp {Math.round(inv.currentValue).toLocaleString('id-ID')}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Cycle Control Center (Admin-only) */}
            {isAdmin && (
              <section className="obsidian-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <div>
                  <h2 style={{ fontSize: '0.85rem' }}>Cycle Control Center</h2>
                  <span className="label-muted" style={{ fontSize: '0.65rem' }}>Panel Kontrol Siklus Admin</span>
                </div>
                
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
                <button type="button" className="btn-titan" style={{ padding: '0.3rem 0.6rem' }} onClick={() => setIsManageInvestorsOpen(false)}>✕</button>
              </div>

              {/* Add Investor Form */}
              <form onSubmit={handleAddInvestor} style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '1rem' }}>
                <span className="label-muted" style={{ fontSize: '0.55rem' }}>Tambah Investor Baru</span>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    placeholder="Nama"
                    value={newInvName}
                    onChange={(e) => setNewInvName(e.target.value)}
                    className="input-titan"
                    style={{ flex: '1 1 120px' }}
                    required
                  />
                  <input
                    type="number"
                    placeholder="Modal Rp"
                    value={newInvDeposit}
                    onChange={(e) => setNewInvDeposit(e.target.value)}
                    className="input-titan"
                    style={{ flex: '1 1 110px' }}
                    required
                  />
                  <input
                    type="number"
                    placeholder="Fee %"
                    value={newInvAdminFeePct}
                    onChange={(e) => setNewInvAdminFeePct(e.target.value)}
                    className="input-titan"
                    style={{ flex: '1 1 70px' }}
                    required
                  />
                  <input
                    type="date"
                    value={newInvJoinDate}
                    onChange={(e) => setNewInvJoinDate(e.target.value)}
                    className="input-titan"
                    style={{ flex: '1 1 120px' }}
                    required
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.2rem' }}>
                  <button type="submit" className="btn-gold" style={{ padding: '0.5rem 1.25rem' }}>
                    <Plus size={14} /> Tambah Investor
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
                    <button
                      onClick={() => handleDeleteInvestor(inv.id)}
                      className="btn-danger-titan"
                      style={{ padding: '0.3rem 0.6rem' }}
                    >
                      <Trash2 size={12} /> Hapus
                    </button>
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
                <button type="button" className="btn-titan" onClick={() => setIsManageInvestorsOpen(false)}>Done</button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
