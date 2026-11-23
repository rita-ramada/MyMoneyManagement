import { NavLink, Route, Routes } from 'react-router-dom';
import Import from './pages/Import';
import Investments from './pages/Investments';
import NetWorth from './pages/NetWorth';
import Settings from './pages/Settings';
import Spending from './pages/Spending';
import Transactions from './pages/Transactions';

const NAV = [
  { to: '/', label: 'Spending' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/import', label: 'Import' },
  { to: '/investments', label: 'Investments' },
  { to: '/net-worth', label: 'Net worth' },
  { to: '/settings', label: 'Settings' },
];

export default function App() {
  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="brand">MyMoney</div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}>{n.label}</NavLink>
        ))}
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Spending />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/import" element={<Import />} />
          <Route path="/investments" element={<Investments />} />
          <Route path="/net-worth" element={<NetWorth />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
