import React from 'react';

interface DetailCardProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

const DetailCard: React.FC<DetailCardProps> = ({ icon, title, subtitle, children }) => (
  <div className="bg-gray-800 rounded-lg border border-gray-700 p-8 mb-8">
    <div className="flex items-center gap-3 mb-4">
      {icon}
      <h1 className="text-3xl font-bold text-gray-100">{title}</h1>
    </div>
    {subtitle && <p className="text-gray-400 mb-4">{subtitle}</p>}
    <div>{children}</div>
  </div>
);

export default DetailCard;
