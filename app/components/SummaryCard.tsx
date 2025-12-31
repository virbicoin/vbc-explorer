import React from 'react';

interface SummaryCardProps {
  title: string;
  value: React.ReactNode;
  sub?: string;
  icon?: React.ReactNode;
  colorClass?: string;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ title, value, sub, icon, colorClass }) => (
  <div
    className={`bg-gray-700/50 rounded-lg p-4 border border-gray-600/50 flex flex-col gap-2 ${colorClass ?? ''}`}
  >
    <div className="flex items-center gap-2 mb-1">
      {icon && <span>{icon}</span>}
      <h3 className="text-sm font-medium text-gray-300">{title}</h3>
    </div>
    <div className="text-2xl font-bold">{value}</div>
    {sub && <p className="text-xs text-gray-400">{sub}</p>}
  </div>
);

export default SummaryCard;
