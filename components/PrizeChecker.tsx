"use client"

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from './ui/textarea';
import { Trophy, DollarSign, TrendingUp, CheckCircle2 } from 'lucide-react';

// 奖金表（已加倍）
const BINGO_PRIZE_TABLE = [
  // 1星
  { stars: 1, hits: 1, prize: 75 },
  // 2星
  { stars: 2, hits: 2, prize: 150 },
  // 3星
  { stars: 3, hits: 2, prize: 50 },
  { stars: 3, hits: 3, prize: 1000 },
  // 4星
  { stars: 4, hits: 2, prize: 25 },
  { stars: 4, hits: 3, prize: 150 },
  { stars: 4, hits: 4, prize: 2000 },
  // 5星
  { stars: 5, hits: 3, prize: 50 },
  { stars: 5, hits: 4, prize: 600 },
  { stars: 5, hits: 5, prize: 10000 },
  // 6星
  { stars: 6, hits: 3, prize: 25 },
  { stars: 6, hits: 4, prize: 200 },
  { stars: 6, hits: 5, prize: 1200 },
  { stars: 6, hits: 6, prize: 50000 }
];

interface Draw {
  period: number;
  date: string;
  numbers: number[];
}

interface PrizeCheckerProps {
  latestDraw: Draw | null;
  multiple: number;
}

interface WinningBet {
  betIndex: number;
  numbers: number[];
  matchCount: number;
  matchedNumbers: number[];
  prize: number;
}

export default function PrizeChecker({ latestDraw, multiple }: PrizeCheckerProps) {
  const [inputText, setInputText] = useState('');
  const [winningBets, setWinningBets] = useState<WinningBet[]>([]);
  const [totalCost, setTotalCost] = useState(0);
  const [totalPrize, setTotalPrize] = useState(0);
  const [isChecked, setIsChecked] = useState(false);
  

  const checkPrizes = () => {
    if (!latestDraw) {
      alert('無最新開獎資料！');
      return;
    }

    // 解析输入的号码
    const lines = inputText.trim().split('\n').filter(line => line.trim());
    const bets: number[][] = [];

    for (const line of lines) {
      const numbers = line.split(',')
        .map(n => parseInt(n.trim()))
        .filter(n => !isNaN(n) && n >= 1 && n <= 80);
      
      if (numbers.length > 0) {
        bets.push(numbers);
      }
    }

    if (bets.length === 0) {
      alert('請輸入有效的號碼！');
      return;
    }

    // 计算每注的中奖情况
    const winningResults: WinningBet[] = [];
    const drawnNumbers = latestDraw.numbers;

    bets.forEach((bet, index) => {
      const stars = bet.length;
      const matchedNumbers = bet.filter(num => drawnNumbers.includes(num));
      const matchCount = matchedNumbers.length;

      // 查找奖金
      let prize = 0;
      const prizeEntry = BINGO_PRIZE_TABLE.find(
        p => p.stars === stars && p.hits === matchCount
      );
      
      if (prizeEntry) {
        prize = prizeEntry.prize * multiple;
      }

      // 只记录有中奖的
      if (prize > 0) {
        winningResults.push({
          betIndex: index + 1,
          numbers: bet,
          matchCount,
          matchedNumbers,
          prize
        });
      }
    });

    // 计算成本和总奖金
    const cost = bets.length * 25 * multiple;
    const totalWinnings = winningResults.reduce((sum, w) => sum + w.prize, 0);

    setWinningBets(winningResults);
    setTotalCost(cost);
    setTotalPrize(totalWinnings);
    setIsChecked(true);
  };

  const clearAll = () => {
    setInputText('');
    setWinningBets([]);
    setTotalCost(0);
    setTotalPrize(0);
    setIsChecked(false);
  };

  const profit = totalPrize - totalCost;

  return (
    <Card className="shadow-2xl border-slate-700 bg-slate-900/50 backdrop-blur-sm hover:bg-slate-900/60 transition-all duration-300">
      <CardHeader className="p-4 sm:p-5 md:p-6">
        <CardTitle className="text-lg sm:text-xl md:text-2xl text-gray-100 font-bold flex items-center gap-2">
          <Trophy className="w-6 h-6 text-yellow-400" />
          兌獎系統
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm md:text-base text-gray-400 mt-1 sm:mt-2">
          輸入您的投注號碼，自動對比最新開獎結果
        </CardDescription>
      </CardHeader>
      
      <CardContent className="p-4 sm:p-5 md:p-6 pt-0 space-y-4">
        {/* 最新开奖信息 */}
        {latestDraw && (
          <div className="bg-purple-900/30 rounded-lg p-4 border border-purple-700/50">
            <div className="text-sm text-gray-300 mb-2">
              最新開獎期數：<span className="text-purple-300 font-bold">第 {latestDraw.period} 期</span>
              <span className="ml-3 text-gray-400">{latestDraw.date}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {latestDraw.numbers.map((num, idx) => (
                <div
                  key={idx}
                  className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-white font-bold flex items-center justify-center text-sm shadow-lg"
                >
                  {num}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 输入区域 */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            請輸入您的投注號碼（每行一注，用逗號分隔）
          </label>
          <Textarea
            value={inputText}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInputText(e.target.value)}
            placeholder="例如：&#10;4,11,18,25&#10;5,12,19,26&#10;7,14,20,27"
            className="min-h-[150px] bg-slate-800/50 border-slate-600 text-gray-100 font-mono text-sm"
            disabled={!latestDraw}
          />
        </div>

        {/* 按钮 */}
        <div className="flex gap-3">
          <Button
            onClick={checkPrizes}
            disabled={!latestDraw || !inputText.trim()}
            className="flex-1 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-semibold"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            開始兌獎
          </Button>
          <Button
            onClick={clearAll}
            variant="outline"
            className="border-slate-600 text-gray-300 hover:bg-slate-800"
          >
            清空
          </Button>
        </div>

        {/* 中奖结果 */}
        {isChecked && (
          <div className="space-y-4 mt-6">
            {winningBets.length > 0 ? (
              <>
                <div className="text-lg font-bold text-green-400 flex items-center gap-2">
                  <Trophy className="w-5 h-5" />
                  恭喜中獎！共 {winningBets.length} 注中獎
                </div>

                {/* 中奖列表 */}
                <div className="space-y-3">
                  {winningBets.map((win) => (
                    <div
                      key={win.betIndex}
                      className="bg-green-900/30 rounded-lg p-4 border border-green-700/50"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-gray-300">
                          第 {win.betIndex} 注 ({win.numbers.length}星)
                        </span>
                        <span className="text-lg font-bold text-green-400">
                          +${win.prize.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 mb-2">
                        {win.numbers.map((num, idx) => {
                          const isMatched = win.matchedNumbers.includes(num);
                          return (
                            <div
                              key={idx}
                              className={`w-8 h-8 rounded-full font-bold flex items-center justify-center text-xs shadow-lg ${
                                isMatched
                                  ? 'bg-gradient-to-br from-green-500 to-emerald-500 text-white ring-2 ring-green-400'
                                  : 'bg-gray-600 text-gray-300'
                              }`}
                            >
                              {num}
                            </div>
                          );
                        })}
                      </div>
                      <div className="text-xs text-gray-400">
                        中 {win.matchCount} 個號碼
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <div className="text-lg mb-2">😢 很遺憾，沒有中獎</div>
                <div className="text-sm">下次再接再厲！</div>
              </div>
            )}

            {/* 统计信息 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
              <div className="bg-blue-900/30 rounded-lg p-4 border border-blue-700/50">
                <div className="text-xs text-gray-400 mb-1">總成本</div>
                <div className="text-xl font-bold text-blue-300">
                  ${totalCost.toLocaleString()}
                </div>
              </div>
              <div className="bg-green-900/30 rounded-lg p-4 border border-green-700/50">
                <div className="text-xs text-gray-400 mb-1">中獎總額</div>
                <div className="text-xl font-bold text-green-300 flex items-center gap-1">
                  <DollarSign className="w-5 h-5" />
                  {totalPrize.toLocaleString()}
                </div>
              </div>
              <div className={`rounded-lg p-4 border ${
                profit >= 0
                  ? 'bg-yellow-900/30 border-yellow-700/50'
                  : 'bg-red-900/30 border-red-700/50'
              }`}>
                <div className="text-xs text-gray-400 mb-1">獲利</div>
                <div className={`text-xl font-bold flex items-center gap-1 ${
                  profit >= 0 ? 'text-yellow-300' : 'text-red-300'
                }`}>
                  <TrendingUp className="w-5 h-5" />
                  {profit >= 0 ? '+' : ''}{profit.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
