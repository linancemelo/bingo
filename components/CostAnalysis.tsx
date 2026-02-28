"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Calculator, TrendingUp, DollarSign, AlertCircle } from 'lucide-react';

interface CostAnalysisProps {
  stars: number;
  multiple: number;
  periods: number;
  bets: number;
}

export default function CostAnalysis({ stars, multiple, periods, bets }: CostAnalysisProps) {
  // 每注基础金额（台币）
  const BASE_BET_AMOUNT = 25;
  
  // 奖金表
  const PRIZE_TABLE: { [key: number]: { [key: string]: number } } = {
    1: { '1': 75 },
    2: { '2': 150 },
    3: { '2': 50, '3': 1000 },
    4: { '2': 25, '3': 150, '4': 2000 },
    5: { '3': 50, '4': 600, '5': 10000 },
    6: { '3': 25, '4': 200, '5': 1200, '6': 50000 },
  };

  // 计算总投注成本
  const totalCost = BASE_BET_AMOUNT * bets * periods * multiple;

  // 获取当前星数的奖金表
  const currentPrizes = PRIZE_TABLE[stars as 3 | 4 | 5 | 6] || {};

  // 计算最大可能获利（中最高奖）
  const maxPrizeKey = Object.keys(currentPrizes).sort((a, b) => parseInt(b) - parseInt(a))[0];
  const maxPrize = currentPrizes[maxPrizeKey] || 0;
  const maxProfit = (maxPrize * multiple * bets * periods) - totalCost;

  // 计算回本分析：需要中多少次某个奖项才能回本
  const breakEvenAnalysis = Object.entries(currentPrizes).map(([hitCount, prize]) => {
    const singleWinAmount = prize * multiple;
    const timesNeeded = Math.ceil(totalCost / singleWinAmount);
    const profitIfWinOnce = singleWinAmount - totalCost;
    
    return {
      hitCount,
      prize,
      singleWinAmount,
      timesNeeded,
      profitIfWinOnce,
      isProfit: profitIfWinOnce > 0
    };
  }).sort((a, b) => parseInt(b.hitCount) - parseInt(a.hitCount));

  // 计算投资回报率 (假设中最高奖)
  const roi = totalCost > 0 ? ((maxProfit / totalCost) * 100).toFixed(2) : '0.00';

  return (
    <Card className="shadow-2xl border-slate-700 bg-slate-900/50 backdrop-blur-sm hover:bg-slate-900/60 transition-all duration-300">
      <CardHeader className="p-3 sm:p-4 md:p-5">
        <CardTitle className="text-base sm:text-lg md:text-xl text-gray-100 font-bold flex items-center gap-2">
          <Calculator className="w-4 h-4 sm:w-5 sm:h-5 text-green-400" />
          成本與中獎分析
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 sm:p-4 md:p-5 pt-0">

        {/* 成本與收益分析 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {/* 總投注成本 */}
          <div className="bg-gradient-to-br from-red-900/40 to-red-800/40 p-3 rounded-lg border border-red-700/50">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-red-300" />
              <div className="text-xs text-red-300 font-medium">總投注成本</div>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-red-100">NT$ {totalCost.toLocaleString()}</div>
            <div className="text-xs text-red-300 mt-1">
              ${BASE_BET_AMOUNT} × {bets}注 × {periods}期 × {multiple}倍
            </div>
          </div>

          {/* 最大可能獲利 */}
          <div className="bg-gradient-to-br from-green-900/40 to-green-800/40 p-3 rounded-lg border border-green-700/50">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-green-300" />
              <div className="text-xs text-green-300 font-medium">最大可能獲利</div>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-green-100">
              {maxProfit > 0 ? '+' : ''}NT$ {maxProfit.toLocaleString()}
            </div>
            <div className="text-xs text-green-300 mt-1">
              中 {maxPrizeKey} 個 × {periods}期 × {bets}注
            </div>
          </div>
        </div>

        {/* 回本分析表 - 简化版 */}
        <div className="bg-slate-800/30 p-3 rounded-lg border border-slate-700">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4 text-yellow-400" />
            <h3 className="text-sm sm:text-base font-bold text-gray-100">回本分析</h3>
          </div>
          
          <div className="space-y-2">
            {breakEvenAnalysis.map((analysis) => (
              <div 
                key={analysis.hitCount}
                className={`p-2 sm:p-3 rounded border transition-all ${
                  analysis.isProfit 
                    ? 'bg-green-900/20 border-green-700/50 hover:bg-green-900/30' 
                    : 'bg-blue-900/20 border-blue-700/50 hover:bg-blue-900/30'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm sm:text-base font-bold text-gray-100">
                      中 {analysis.hitCount}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700/50 text-gray-300">
                      ${analysis.prize}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className={analysis.isProfit ? 'text-green-300' : 'text-blue-300'}>
                      {analysis.profitIfWinOnce > 0 ? '+' : ''}${Math.abs(analysis.profitIfWinOnce)}
                    </span>
                    <span className="text-yellow-300">
                      需中{analysis.timesNeeded}次
                    </span>
                    {analysis.isProfit && (
                      <span className="text-green-400 font-bold">✓</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 風險提示 - 简化版 */}
        <div className="mt-3 p-2 sm:p-3 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-yellow-200">
              以上分析僅供參考。請理性購彩，適度遊戲。
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
