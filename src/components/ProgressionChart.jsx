import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine
} from 'recharts';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div 
        style={{
          background: 'var(--bg-card)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          padding: '0.8rem 1.1rem',
          borderRadius: '16px',
          boxShadow: '0 12px 30px rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(10px)',
          fontFamily: 'var(--sans)'
        }}
      >
        <p style={{ margin: 0, fontWeight: 700, fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
          {label}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {payload.map((p, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: p.color }} />
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#ffffff', fontWeight: 600, fontFamily: 'var(--mono)' }}>
                {p.name}: <span style={{ color: p.color }}>Rp {p.value.toLocaleString('id-ID')}</span>
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

export default function ProgressionChart({ chartData }) {
  const formatYAxis = (value) => {
    if (value === 0) return '0';
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`;
    }
    return value.toLocaleString('id-ID');
  };

  // Determine dynamic min/max values for better chart bounds
  const actualValues = chartData.map(d => d.actual).filter(v => v !== null && v !== undefined);
  
  const minVal = actualValues.length > 0 ? Math.min(...actualValues) : 8_200_000;
  const maxVal = actualValues.length > 0 ? Math.max(...actualValues) : 10_000_000;
  
  // Give some padding at the bottom and top
  const yDomainMin = Math.max(0, Math.floor(minVal * 0.95 / 1000000) * 1000000);
  const yDomainMax = Math.ceil((maxVal * 1.05) / 1000000) * 1000000;

  return (
    <div className="chart-wrapper">
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart
          data={chartData}
          margin={{ top: 15, right: 10, left: -10, bottom: 5 }}
        >
          <defs>
            <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-lime)" stopOpacity={0.2}/>
              <stop offset="95%" stopColor="var(--color-lime)" stopOpacity={0.0}/>
            </linearGradient>
          </defs>
          
          <CartesianGrid 
            strokeDasharray="4 4" 
            stroke="rgba(255, 255, 255, 0.015)" 
            vertical={false}
          />
          
          <XAxis 
            dataKey="date" 
            stroke="var(--text-muted)" 
            fontSize={10}
            fontWeight={600}
            tickLine={false}
            dy={8}
            fontFamily="var(--mono)"
          />
          
          <YAxis 
            stroke="var(--text-muted)" 
            fontSize={10}
            fontWeight={600}
            tickLine={false}
            tickFormatter={formatYAxis}
            dx={-5}
            domain={[yDomainMin, yDomainMax]}
            fontFamily="var(--mono)"
          />
          
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255, 255, 255, 0.04)', strokeWidth: 1 }} />

          {/* Actual Balance Path */}
          <Area
            name="Actual Balance"
            type="monotone"
            dataKey="actual"
            stroke="var(--color-lime)"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorActual)"
            activeDot={{ r: 5, strokeWidth: 0, fill: 'var(--color-lime)' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
