import React from 'react';

interface InfoTableProps {
  data: Array<{ label: string; value: React.ReactNode }>;
  className?: string;
}

const InfoTable: React.FC<InfoTableProps> = ({ data, className }) => (
  <table className={`w-full text-sm text-gray-300 ${className ?? ''}`}>
    <tbody>
      {data.map((row, idx) => (
        <tr key={idx} className="border-b border-gray-700 last:border-0">
          <td className="py-2 pr-4 font-medium text-gray-400 whitespace-nowrap w-1/3">
            {row.label}
          </td>
          <td className="py-2 break-all">{row.value}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

export default InfoTable;
