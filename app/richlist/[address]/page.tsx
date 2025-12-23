import { getCurrencySymbol } from '../../../lib/config';

export default async function RichlistPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return (
    <>
      {/* Page Header */}
      <div className='page-header-container'>
        <div className='container mx-auto px-4 py-8'>
          <h1 className='text-3xl font-bold mb-2 text-gray-100'>Richlist</h1>
          <p className='text-gray-400'>A list of the richest accounts.</p>
        </div>
      </div>

      <main className='container mx-auto px-4 py-8'>
        {/* Richlist Info Card */}
        <div className='bg-gray-800 rounded-lg border border-gray-700 p-6 mb-6'>
          <div className='grid grid-cols-1 md:grid-cols-3 gap-6'>
            <div className='md:col-span-2'>
              <h3 className='text-lg font-semibold text-gray-100 mb-4'>Richlist Information</h3>
              <div className='space-y-3'>
                <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
                  <span className='text-gray-400 font-medium min-w-[80px]'>Address:</span>
                  <span className='font-mono text-blue-400 break-all'>{address}</span>
                </div>
                <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
                  <span className='text-gray-400 font-medium min-w-[80px]'>Balance:</span>
                  <span className='text-green-400 font-bold'>195,735.13950591 {getCurrencySymbol()}</span>
                </div>
                <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
                  <span className='text-gray-400 font-medium min-w-[80px]'>Percent:</span>
                  <span className='text-yellow-400'>14.8501%</span>
                </div>
              </div>
            </div>
            <div className='bg-gray-700/50 rounded-lg p-4 border border-gray-600/50'>
              <h4 className='text-sm font-medium text-gray-300 mb-2'>Quick Stats</h4>
              <div className='space-y-2 text-sm'>
                <div className='flex justify-between'>
                  <span className='text-gray-400'>Transactions:</span>
                  <span className='text-gray-200'>1,234</span>
                </div>
                <div className='flex justify-between'>
                  <span className='text-gray-400'>First Seen:</span>
                  <span className='text-gray-200'>2 years ago</span>
                </div>
                <div className='flex justify-between'>
                  <span className='text-gray-400'>Last Activity:</span>
                  <span className='text-gray-200'>1 hour ago</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Transactions */}
        <div className='bg-gray-800 rounded-lg border border-gray-700 p-6'>
          <div className='flex items-center justify-between mb-4'>
            <h3 className='text-xl font-semibold text-gray-100'>Transactions</h3>
            <span className='text-sm text-gray-400'>Latest 10 transactions</span>
          </div>
          <div className='overflow-x-auto'>
            <table className='w-full'>
              <thead>
                <tr className='border-b border-gray-700'>
                  <th className='text-left py-3 px-2 text-sm font-medium text-gray-300'>TxHash</th>
                  <th className='text-left py-3 px-2 text-sm font-medium text-gray-300'>From</th>
                  <th className='text-left py-3 px-2 text-sm font-medium text-gray-300'>To</th>
                  <th className='text-left py-3 px-2 text-sm font-medium text-gray-300'>Value</th>
                  <th className='text-left py-3 px-2 text-sm font-medium text-gray-300'>Time</th>
                </tr>
              </thead>
              <tbody className='divide-y divide-gray-700'>
                {[1, 2, 3].map((n) => (
                  <tr key={n} className='hover:bg-gray-700/50 transition-colors'>
                    <td className='py-3 px-2'>
                      <a href='#' className='font-mono text-blue-400 hover:text-blue-300 transition-colors text-sm'>
                        0x...{1234 + n}
                      </a>
                    </td>
                    <td className='py-3 px-2 font-mono text-gray-300 text-sm'>0x...abcd</td>
                    <td className='py-3 px-2 font-mono text-gray-300 text-sm'>0x...efgh</td>
                    <td className='py-3 px-2 text-green-400 font-medium'>{n * 1000} {getCurrencySymbol()}</td>
                    <td className='py-3 px-2 text-gray-400 text-sm'>{n} hour ago</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </>
  );
}