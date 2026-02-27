import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || ''
});

export async function POST(request: Request) {
  let historicalData: any[] = [];
  let periods = 5; // 默认值
  let coldestNumbers: number[] = [];
  let lowestBlockNumbers: number[] = [];
  try {
    const body = await request.json();
    const { strategy, stars, bets = 1 } = body;
    historicalData = body.historicalData || [];
    periods = body.periods || 5;
    coldestNumbers = body.coldestNumbers || [];
    lowestBlockNumbers = body.lowestBlockNumbers || [];
    
    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: '請設定 GROQ_API_KEY 環境變數' },
        { status: 500 }
      );
    }

    // 🎯 判斷投注模式：多期一注 vs 一期多注
    const isMultiPeriodSingleBet = periods > 1 && bets === 1;
    
    // 🎯 判斷策略：連號策略不排除上期號碼
    const isConsecutiveStrategy = strategy === 'consecutive';
    
    // 獲取上一期號碼用於排除（連號策略除外）
    const lastDrawNumbers = (historicalData.length > 0 && !isConsecutiveStrategy) 
      ? historicalData[0].numbers 
      : [];
    
    // 如果不是多期一注，需要計算排除的號碼
    if (!isMultiPeriodSingleBet) {
      // 計算最冷門號碼（所有策略都需要）
      if (coldestNumbers.length === 0) {
        const recentNumbers = historicalData.slice(0, periods).flatMap((d: any) => d.numbers);
        const frequency: { [key: number]: number } = {};
        for (let i = 1; i <= 80; i++) {
          frequency[i] = 0;
        }
        recentNumbers.forEach((num: number) => {
          frequency[num] = (frequency[num] || 0) + 1;
        });
        
        // 🎯 先找出0次的號碼
        const zeroFreqNumbers = Object.entries(frequency)
          .filter(([, count]) => count === 0)
          .map(([num]) => parseInt(num));
        
        console.log(`🎯 0次號碼數量: ${zeroFreqNumbers.length}`);
        
        // 如果0次號碼不足20個，從冷門號碼補齊到20個
        if (zeroFreqNumbers.length < 20) {
          const sortedByFreq = Object.entries(frequency)
            .filter(([num]) => !zeroFreqNumbers.includes(parseInt(num))) // 排除已經在0次列表的
            .sort(([, a], [, b]) => (a as number) - (b as number))
            .map(([num]) => parseInt(num));
          
          const needed = 20 - zeroFreqNumbers.length;
          const additionalCold = sortedByFreq.slice(0, needed);
          coldestNumbers = [...zeroFreqNumbers, ...additionalCold];
        } else {
          // 如果0次號碼超過20個，只取前20個
          coldestNumbers = zeroFreqNumbers.slice(0, 20);
        }
        
        console.log(`🎯 最終排除最冷門號碼數量: ${coldestNumbers.length}`);
      }
      
      // 計算低頻區塊（所有策略都需要）
      if (lowestBlockNumbers.length === 0) {
        lowestBlockNumbers = calculateLowestBlockNumbers(historicalData, periods);
      }
    }

    const prompt = generatePrompt(strategy, historicalData, stars, periods, bets, coldestNumbers, lowestBlockNumbers, isMultiPeriodSingleBet, isConsecutiveStrategy);
    
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: isMultiPeriodSingleBet 
            ? `你是一個專業的台灣賓果彩券分析師。請根據歷史資料分析並推薦${bets}組號碼（每組${stars}個號碼）。

🎯 號碼選擇優先序
- 最高 熱門號碼
- 次高 號碼球頻率分析（1-80）最多次數區塊

🎯 多期單注策略：
- 用戶選擇了 ${periods} 期，每期只買 1 注
- 同一組號碼要使用多期，因此需要選擇「長期穩定」的號碼
- 使用 Top 10-15 熱門號碼進行排列組合
- 這些號碼在多期內都有較高的出現機率

🎯 分析策略：
- 目標：提高「長期穩定命中率」（多期累積至少中獎幾次）
- 實際觀察：3星通常只能3中2
- 選擇在歷史數據中「長期高頻」的號碼
- 這些號碼在接下來的多期內都有機會出現

返回JSON格式：{"bets": [[第1注號碼], [第2注號碼], ...], "reasoning": "分析理由"}`
            : isConsecutiveStrategy
            ? `你是一個專業的台灣賓果彩券分析師。請根據歷史資料分析並推薦${bets}組號碼（每組${stars}個號碼）。

🎯 連號策略（排除規則）：
- ❌ 不排除上一期的號碼（連號可能持續出現）
- ⚠️ 必須排除最冷門的 20 個號碼（含0次號碼）：${coldestNumbers.join(', ')}
- ⚠️ 必須排除頻率最低的兩個區塊號碼：${lowestBlockNumbers.join(', ')}
- ⚠️ 每注必須是 ${stars} 個「完全連續」的號碼
- ⚠️ 不要斷開！${stars}星 = ${stars}個連續號碼
- 例如：3星 → [12,13,14] 或 [25,26,27]
- 例如：4星 → [8,9,10,11] 或 [45,46,47,48]

🎯 分析策略：
- 分析歷史數據中哪些連號區間出現頻率較高
- 選擇「有潛力」的連號組合
- 不同注之間選擇不同的連號區間
- 目標：${stars}個連續號碼中至少命中${Math.max(2, Math.floor(stars * 0.6))}個

返回JSON格式：{"bets": [[第1注號碼], [第2注號碼], ...], "reasoning": "分析理由"}`
            : `你是一個專業的台灣賓果彩券分析師。請根據歷史資料分析並推薦${bets}組號碼（每組${stars}個號碼）。

🎯 AI 智慧建議策略（混搭策略）：
- ⚠️ 必須排除上一期的 20 個中獎號碼：${lastDrawNumbers.join(', ')}
- ⚠️ 必須排除最冷門的 20 個號碼（含0次號碼）：${coldestNumbers.join(', ')}
- ⚠️ 必須排除頻率最低的兩個區塊號碼：${lowestBlockNumbers.join(', ')}
- ✅ 可以從剩餘號碼中自由混搭：
  - 熱門號碼（高頻號碼）
  - 次冷門號碼（但不是最冷門的20個）
  - 不規則連號（例如：12,13 或 25,26,27 等部分連號）

🎯 分析策略：
- 目標：提高"部分命中率"（3星至少中2個，4星至少中3個）
- 實際觀察：3星通常只能3中2
- 可以自由混搭：熱門 + 次冷門 + 不規則連號
- 為每注設計不同的混搭組合
- 不同注之間可以有重複號碼

返回JSON格式：{"bets": [[第1注號碼], [第2注號碼], ...], "reasoning": "分析理由"}`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7,
      max_tokens: 2048,
    });

    const content = chatCompletion.choices[0]?.message?.content || '';
    
    let parsedResponse;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      } else {
        parsedResponse = {
          bets: generateFallbackBets(
            bets, 
            stars, 
            isConsecutiveStrategy ? [...coldestNumbers, ...lowestBlockNumbers] : [...lastDrawNumbers, ...coldestNumbers, ...lowestBlockNumbers]
          ),
          reasoning: content
        };
      }
    } catch (e) {
      parsedResponse = {
        bets: generateFallbackBets(
          bets, 
          stars, 
          isConsecutiveStrategy ? [...coldestNumbers, ...lowestBlockNumbers] : [...lastDrawNumbers, ...coldestNumbers, ...lowestBlockNumbers]
        ),
        reasoning: content
      };
    }

    // 兼容旧格式（单注）
    if (parsedResponse.numbers && !parsedResponse.bets) {
      parsedResponse.bets = [parsedResponse.numbers.sort((a: number, b: number) => a - b)];
    }

    if (!parsedResponse.bets || parsedResponse.bets.length === 0) {
      parsedResponse.bets = generateFallbackBets(
        bets, 
        stars, 
        isConsecutiveStrategy ? [...coldestNumbers, ...lowestBlockNumbers] : [...lastDrawNumbers, ...coldestNumbers, ...lowestBlockNumbers]
      );
    }

    // 🎯 确保返回的注数与请求的注数一致
    if (parsedResponse.bets.length < bets) {
      console.log(`⚠️ AI返回注数不足：期望${bets}注，实际${parsedResponse.bets.length}注，补充中...`);
      // 补充不足的注数
      const additionalBets = generateFallbackBets(
        bets - parsedResponse.bets.length, 
        stars, 
        isConsecutiveStrategy ? [] : [...lastDrawNumbers, ...coldestNumbers, ...lowestBlockNumbers]
      );
      parsedResponse.bets = [...parsedResponse.bets, ...additionalBets];
    } else if (parsedResponse.bets.length > bets) {
      console.log(`⚠️ AI返回注数过多：期望${bets}注，实际${parsedResponse.bets.length}注，截断中...`);
      // 截断多余的注数
      parsedResponse.bets = parsedResponse.bets.slice(0, bets);
    }

    // 确保每注都有正确数量的号码，从小到大排序
    // 连号策略需要验证是否为完全连续的号码
    if (isConsecutiveStrategy) {
      // 连号策略：验证是否为完全连续号码，并且不包含被排除的号码
      const excludedNumbers = [...coldestNumbers, ...lowestBlockNumbers];
      
      // 计算热门号码（用于优先生成包含热门号的连号）
      const recentNumbers = historicalData.slice(0, periods).flatMap((d: any) => d.numbers);
      const frequency: { [key: number]: number } = {};
      for (let i = 1; i <= 80; i++) {
        frequency[i] = 0;
      }
      recentNumbers.forEach((num: number) => {
        frequency[num] = (frequency[num] || 0) + 1;
      });
      const availablePool = Array.from({ length: 80 }, (_, i) => i + 1)
        .filter(num => !excludedNumbers.includes(num));
      const topHotNumbers = Object.entries(frequency)
        .filter(([num]) => availablePool.includes(parseInt(num)))
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .slice(0, 20)
        .map(([num]) => parseInt(num));
      
      console.log(`🎯 后处理：Top 20 热门号码: ${topHotNumbers.join(', ')}`);
      
      parsedResponse.bets = parsedResponse.bets.map((bet: number[]) => {
        let sortedBet = bet.slice(0, stars).sort((a, b) => a - b);
        
        // 验证是否为连续号码
        const isConsecutive = sortedBet.every((num, idx) => {
          if (idx === 0) return true;
          return num === sortedBet[idx - 1] + 1;
        });
        
        // 检查是否包含被排除的号码
        const hasExcludedNumber = sortedBet.some(num => excludedNumbers.includes(num));
        
        // 如果不是连续号码，或者包含被排除的号码，重新生成
        if (!isConsecutive || sortedBet.length < stars || hasExcludedNumber) {
          console.log(`⚠️ 连号策略：检测到无效号码组合 [${sortedBet.join(',')}]，重新生成`);
          
          // 🔥 优先生成包含热门号码的连号组合
          const consecutiveGroupsWithHot: { group: number[], hotCount: number }[] = [];
          
          // 从每个热门号码出发，尝试生成连号
          for (const hotNum of topHotNumbers) {
            // 往前延伸
            for (let offset = 0; offset < stars; offset++) {
              const start = hotNum - offset;
              if (start >= 1 && start + stars - 1 <= 80) {
                const group = Array.from({ length: stars }, (_, i) => start + i);
                const allValid = group.every(n => availablePool.includes(n));
                if (allValid) {
                  const hotCount = group.filter(n => topHotNumbers.includes(n)).length;
                  consecutiveGroupsWithHot.push({ group, hotCount });
                }
              }
            }
          }
          
          // 如果没有找到包含热门号的连号，寻找所有可能的连号
          if (consecutiveGroupsWithHot.length === 0) {
            let currentGroup: number[] = [];
            for (let i = 1; i <= 80; i++) {
              if (availablePool.includes(i)) {
                currentGroup.push(i);
                if (currentGroup.length === stars) {
                  const hotCount = currentGroup.filter(n => topHotNumbers.includes(n)).length;
                  consecutiveGroupsWithHot.push({ group: [...currentGroup], hotCount });
                  currentGroup.shift();
                }
              } else {
                currentGroup = [];
              }
            }
          }
          
          if (consecutiveGroupsWithHot.length > 0) {
            // 按包含热门号数量排序，优先选择包含更多热门号的连号
            consecutiveGroupsWithHot.sort((a, b) => b.hotCount - a.hotCount);
            
            // 显示前10个候选连号组合
            console.log(`📊 可选连号组合（前10个，按热门号数量排序）：`);
            consecutiveGroupsWithHot.slice(0, 10).forEach((item, idx) => {
              console.log(`   ${idx+1}. [${item.group.join(',')}] - ${item.hotCount}个热门号`);
            });
            
            // 从前30%中随机选择一个（保持多样性）
            const topCandidates = consecutiveGroupsWithHot.slice(0, Math.max(1, Math.ceil(consecutiveGroupsWithHot.length * 0.3)));
            const randomIndex = Math.floor(Math.random() * topCandidates.length);
            const selected = topCandidates[randomIndex];
            sortedBet = selected.group;
            
            console.log(`✅ 最终选择连号组 [${sortedBet.join(',')}]，包含 ${selected.hotCount} 个热门号`);
          } else {
            // 如果没有找到符合条件的连续号码组，退而求其次，选择热门号码
            console.log(`⚠️ 警告：无法找到符合条件的连号组，使用热门号码代替`);
            sortedBet = generateFallbackNumbers(stars, excludedNumbers);
          }
        }
        
        return sortedBet;
      });
    } else {
      // 其他策略：过滤上期号码、最冷门号码和低频区块号码
      const excludedNumbers = [...lastDrawNumbers, ...coldestNumbers, ...lowestBlockNumbers];
      parsedResponse.bets = parsedResponse.bets.map((bet: number[]) => {
        let sortedBet: number[];
        const filteredBet = bet.filter(num => !excludedNumbers.includes(num));
        
        if (filteredBet.length < stars) {
          sortedBet = [...filteredBet, ...generateFallbackNumbers(stars - filteredBet.length, excludedNumbers)].slice(0, stars);
        } else {
          sortedBet = filteredBet.slice(0, stars);
        }
        return sortedBet.sort((a, b) => a - b);
      });
    }

    // 🎯 去重检查：确保不同注之间没有完全重复的号码组合
    const uniqueBets: number[][] = [];
    const betSignatures = new Set<string>();
    
    for (const bet of parsedResponse.bets) {
      const signature = bet.sort((a: number, b: number) => a - b).join(',');
      
      if (!betSignatures.has(signature)) {
        uniqueBets.push(bet);
        betSignatures.add(signature);
      } else {
        console.log(`⚠️ 检测到重复注码：[${signature}]，跳过`);
      }
    }
    
    // 如果去重后注数不足，补充新的注码
    if (uniqueBets.length < bets) {
      console.log(`⚠️ 去重后注数不足：期望${bets}注，实际${uniqueBets.length}注，补充中...`);
      
      const excludedNumbers = isConsecutiveStrategy 
        ? [...coldestNumbers, ...lowestBlockNumbers]
        : [...lastDrawNumbers, ...coldestNumbers, ...lowestBlockNumbers];
      
      if (isConsecutiveStrategy) {
        // 连号策略：补充不重复的连续号码组（优先包含热门号）
        const availablePool = Array.from({ length: 80 }, (_, i) => i + 1)
          .filter(num => !excludedNumbers.includes(num));
        
        // 计算热门号码
        const recentNumbers = historicalData.slice(0, periods).flatMap((d: any) => d.numbers);
        const frequency: { [key: number]: number } = {};
        for (let i = 1; i <= 80; i++) {
          frequency[i] = 0;
        }
        recentNumbers.forEach((num: number) => {
          frequency[num] = (frequency[num] || 0) + 1;
        });
        const topHotNumbers = Object.entries(frequency)
          .filter(([num]) => availablePool.includes(parseInt(num)))
          .sort(([, a], [, b]) => (b as number) - (a as number))
          .slice(0, 20)
          .map(([num]) => parseInt(num));
        
        // 找出所有可能的连续号码组合（优先包含热门号）
        const consecutiveGroupsWithHot: { group: number[], hotCount: number }[] = [];
        
        // 从每个热门号码出发生成连号
        for (const hotNum of topHotNumbers) {
          for (let offset = 0; offset < stars; offset++) {
            const start = hotNum - offset;
            if (start >= 1 && start + stars - 1 <= 80) {
              const group = Array.from({ length: stars }, (_, i) => start + i);
              const signature = group.join(',');
              const allValid = group.every(n => availablePool.includes(n));
              
              if (allValid && !betSignatures.has(signature)) {
                const hotCount = group.filter(n => topHotNumbers.includes(n)).length;
                consecutiveGroupsWithHot.push({ group, hotCount });
              }
            }
          }
        }
        
        // 如果还不够，添加其他所有可能的连号
        if (consecutiveGroupsWithHot.length < bets - uniqueBets.length) {
          let currentGroup: number[] = [];
          for (let i = 1; i <= 80; i++) {
            if (availablePool.includes(i)) {
              currentGroup.push(i);
              
              if (currentGroup.length === stars) {
                const signature = [...currentGroup].join(',');
                if (!betSignatures.has(signature)) {
                  const hotCount = currentGroup.filter(n => topHotNumbers.includes(n)).length;
                  // 避免重复添加
                  const exists = consecutiveGroupsWithHot.some(g => g.group.join(',') === signature);
                  if (!exists) {
                    consecutiveGroupsWithHot.push({ group: [...currentGroup], hotCount });
                  }
                }
                currentGroup.shift();
              }
            } else {
              currentGroup = [];
            }
          }
        }
        
        // 按包含热门号数量排序
        consecutiveGroupsWithHot.sort((a, b) => b.hotCount - a.hotCount);
        
        // 选择包含最多热门号的连号组
        for (const item of consecutiveGroupsWithHot) {
          if (uniqueBets.length >= bets) break;
          
          const signature = item.group.join(',');
          if (!betSignatures.has(signature)) {
            uniqueBets.push(item.group);
            betSignatures.add(signature);
            console.log(`✅ 补充连号注码：[${signature}]，包含 ${item.hotCount} 个热门号`);
          }
        }
      } else {
        // 其他策略：补充不重复的随机注码
        while (uniqueBets.length < bets) {
          const newBet = generateFallbackNumbers(stars, excludedNumbers);
          const signature = newBet.sort((a, b) => a - b).join(',');
          
          if (!betSignatures.has(signature)) {
            uniqueBets.push(newBet);
            betSignatures.add(signature);
            console.log(`✅ 补充随机注码：[${signature}]`);
          }
        }
      }
    }
    
    parsedResponse.bets = uniqueBets;
    console.log(`✅ 最终返回 ${uniqueBets.length} 注不重复的号码组合`);

    return NextResponse.json({
      success: true,
      data: parsedResponse
    });

  } catch (error: any) {
    console.error('AI Analysis error:', error);
    const fallbackBets = 1;
    
    // 計算排除的號碼（上期 + 最冷門10個）
    const lastDrawNumbers = historicalData.length > 0 ? historicalData[0].numbers : [];
    
    // 如果没有coldestNumbers，在error handler中计算
    let coldest20 = coldestNumbers.length > 0 ? coldestNumbers : [];
    if (coldest20.length === 0) {
      const recentNumbers = historicalData.slice(0, periods).flatMap((d: any) => d.numbers);
      const frequency: { [key: number]: number } = {};
      for (let i = 1; i <= 80; i++) {
        frequency[i] = 0;
      }
      recentNumbers.forEach((num: number) => {
        frequency[num] = (frequency[num] || 0) + 1;
      });
      
      // 先找出0次的號碼
      const zeroFreqNumbers = Object.entries(frequency)
        .filter(([, count]) => count === 0)
        .map(([num]) => parseInt(num));
      
      // 如果0次號碼不足20個，從冷門號碼補齊到20個
      if (zeroFreqNumbers.length < 20) {
        const sortedByFreq = Object.entries(frequency)
          .filter(([num]) => !zeroFreqNumbers.includes(parseInt(num)))
          .sort(([, a], [, b]) => (a as number) - (b as number))
          .map(([num]) => parseInt(num));
        
        const needed = 20 - zeroFreqNumbers.length;
        const additionalCold = sortedByFreq.slice(0, needed);
        coldest20 = [...zeroFreqNumbers, ...additionalCold];
      } else {
        coldest20 = zeroFreqNumbers.slice(0, 20);
      }
    }
    
    // 計算最低頻區塊號碼
    let lowestBlocks = lowestBlockNumbers.length > 0 ? lowestBlockNumbers : [];
    if (lowestBlocks.length === 0) {
      lowestBlocks = calculateLowestBlockNumbers(historicalData, periods);
    }
    
    const excludedNumbers = [...lastDrawNumbers, ...coldest20, ...lowestBlocks];
    
    return NextResponse.json(
      { 
        error: error.message || '分析失敗',
        fallback: {
          bets: generateFallbackBets(fallbackBets, 5, excludedNumbers),
          reasoning: '由於 API 錯誤，這是基於隨機演算法生成的推薦號碼（已排除上期號碼、最冷門20個號碼和最低頻區塊號碼）'
        }
      },
      { status: 500 }
    );
  }
}

function generatePrompt(strategy: string, historicalData: any[], stars: number, periods: number, bets: number, coldestNumbers: number[], lowestBlockNumbers: number[], isMultiPeriodSingleBet: boolean, isConsecutiveStrategy: boolean): string {
  const lastDrawNumbers = historicalData.length > 0 ? historicalData[0].numbers : [];
  
  // 計算頻率
  const recentNumbers = historicalData.slice(0, periods).flatMap(d => d.numbers);
  const frequency: { [key: number]: number } = {};
  
  for (let i = 1; i <= 80; i++) {
    frequency[i] = 0;
  }
  
  recentNumbers.forEach(num => {
    frequency[num] = (frequency[num] || 0) + 1;
  });

  const sortedByFreq = Object.entries(frequency)
    .sort(([, a], [, b]) => b - a)
    .map(([num]) => parseInt(num));

  // 🎯 策略分歧：多期一注 vs 連號策略 vs 一期多注
  if (isMultiPeriodSingleBet) {
    // 多期一注：使用 Top 10-15 熱門號碼
    const topHotNumbers = sortedByFreq.slice(0, 15);
    
    console.log(`🎯 多期單注策略：使用 Top 15 熱門號碼`);
    console.log(`🎯 長期熱門號碼: ${topHotNumbers.join(', ')}`);

    let strategyPrompt = '';
    
    switch (strategy) {
      case 'hot':
        strategyPrompt = `請使用「長期熱門策略」：從 Top 15 熱門號碼中選擇。
        
🎯 多期策略重點：
- 這組號碼要用 ${periods} 期，因此需要選擇「長期穩定」的號碼
- 從 Top 15 熱門號碼中選擇最穩定的組合
- 目標：在 ${periods} 期內至少命中${Math.max(2, Math.floor(stars * 0.6))}個號碼多次
- Top 15 熱門號碼: ${topHotNumbers.join(', ')}`;
        break;
      case 'consecutive':
        strategyPrompt = `請使用「熱門連號策略」：從 Top 15 熱門號碼中尋找連號。
        
🎯 多期策略重點：
- 從 Top 15 熱門號碼中尋找1-2組連號
- 其他號碼也從熱門池中選擇
- 目標：在 ${periods} 期內穩定命中
- Top 15 熱門號碼: ${topHotNumbers.join(', ')}`;
        break;
      default:
        strategyPrompt = `請使用「長期穩定策略」：從 Top 15 熱門號碼中選擇。
        
🎯 多期策略重點：
- 這組號碼要用 ${periods} 期
- 從 Top 15 熱門號碼中選擇最有潛力的組合
- 選擇在歷史上「持續高頻」的號碼
- 目標：長期穩定命中
- Top 15 熱門號碼: ${topHotNumbers.join(', ')}`;
    }

    return `${strategyPrompt}

📊 投注模式：
- 期數：${periods} 期
- 注數：每期 ${bets} 注
- 每組號碼數：${stars} 個
- 策略：長期熱門包牌

重要原則：
1. 💡 從 Top 15 熱門號碼中選擇
2. 💡 選擇「長期穩定」而非「單期熱門」的號碼
3. 每組號碼請按從小到大排序
4. 🎯 目標：在多期內穩定命中

請以JSON格式返回：
{
  "bets": [
    [第1組的${stars}個號碼（從小到大排序）],
    [第2組的${stars}個號碼（從小到大排序）],
    ${bets > 2 ? '...' : ''}
  ],
  "reasoning": "簡短的分析理由（150字以內），說明為何這些號碼在多期內有穩定命中機率"
}`;
  } else if (isConsecutiveStrategy) {
    // 連號策略：從熱門號碼出發，向前或向後延伸形成連號
    const availablePool = Array.from({ length: 80 }, (_, i) => i + 1)
      .filter(num => !coldestNumbers.includes(num) && !lowestBlockNumbers.includes(num));
    
    // 獲取熱門號碼（在可選池中的）
    const topHotNumbers = sortedByFreq.filter(n => availablePool.includes(n)).slice(0, 20);
    
    console.log(`🎯 連號策略：從熱門號碼出發形成連號`);
    console.log(`🎯 排除最冷門號碼 (20個): ${coldestNumbers.join(', ')}`);
    console.log(`🎯 排除低頻區塊號碼 (${lowestBlockNumbers.length}個): ${lowestBlockNumbers.join(', ')}`);
    console.log(`🎯 可選號碼池 (${availablePool.length}個): ${availablePool.join(', ')}`);
    console.log(`🎯 Top 20 熱門號碼: ${topHotNumbers.join(', ')}`);
    console.log(`🎯 要求：${stars}星 = ${stars}個完全連續的號碼`);

    const strategyPrompt = `請使用「熱門連號策略」分析方法。
    
🎯 連號策略重點（${stars}個完全連續號碼）：
- ⚠️ 每注必須是 ${stars} 個「完全連續」的號碼，不要斷開！
- 🔥 **核心策略：從熱門號碼出發，往前或往後延伸形成連號**
- 例如：
  ${stars === 3 ? '如果 12 是熱門號，可以選 [10,11,12] 或 [11,12,13] 或 [12,13,14]' : ''}
  ${stars === 4 ? '如果 25 是熱門號，可以選 [23,24,25,26] 或 [24,25,26,27] 或 [25,26,27,28]' : ''}
  ${stars === 5 ? '如果 35 是熱門號，可以選 [33,34,35,36,37] 或 [35,36,37,38,39]' : ''}
  ${stars >= 6 ? stars + '星 → 包含熱門號的' + stars + '個連續號碼' : ''}

🎯 排除規則：
- ❌ 不排除上一期的號碼（連號可能持續出現）
- ⚠️ 必須排除最冷門的 20 個號碼（含0次號碼）：${coldestNumbers.join(', ')}
- ⚠️ 必須排除頻率最低的兩個區塊號碼：${lowestBlockNumbers.join(', ')}
- ✅ 可選號碼池（${availablePool.length}個）：${availablePool.join(', ')}
- 🔥 Top 20 熱門號碼（優先考慮）：${topHotNumbers.join(', ')}

🎯 策略要點：
1. **從 Top 20 熱門號碼中選擇一個作為「錨點」**
2. 從這個熱門號往前或往後延伸 ${stars} 個連續號碼
3. 確保連號中至少包含1個熱門號碼
4. 確保所有號碼都在可選號碼池中（不被排除）
5. 優先選擇包含「多個」熱門號碼的連號組合
6. 不同注選擇不同的連號區間
7. 目標：${stars}個連續號碼中至少命中${Math.max(2, Math.floor(stars * 0.6))}個號碼`;

    return `${strategyPrompt}

📊 投注模式：
- 期數：${periods} 期
- 注數：每期 ${bets} 注
- 每組號碼數：${stars} 個「完全連續」的號碼
- 策略：熱門連號模式（從熱門號出發形成連號）

重要原則：
1. ⚠️ 每注必須是 ${stars} 個完全連續的號碼（例如：12,13,14,15...）
2. 🔥 每個連號組合必須包含至少1個 Top 20 熱門號碼
3. ⚠️ 必須從可選號碼池中選擇，不能選擇被排除的號碼
4. 💡 優先選擇包含「多個熱門號」的連號組合
5. 💡 從熱門號往前或往後延伸（例如：熱門號35 → [33,34,35] 或 [35,36,37]）
6. 每組號碼請按從小到大排序（自然就是連續的）
7. 🎯 不同注選擇不同的熱門號作為錨點
8. 🎯 實戰觀察：連號命中通常是部分命中（${stars}中${Math.max(2, Math.floor(stars * 0.6))}）

請以JSON格式返回：
{
  "bets": [
    [第1組的${stars}個「連續」號碼（包含熱門號）],
    [第2組的${stars}個「連續」號碼（包含熱門號）],
    ${bets > 2 ? '...' : ''}
  ],
  "reasoning": "簡短的分析理由（150字以內），說明選擇了哪些熱門號作為錨點，以及為何這些連號區間有較高的部分命中機率"
}`;
  } else {
    // 一期多注：使用動態排除策略
    const availablePool = Array.from({ length: 80 }, (_, i) => i + 1)
      .filter(num => !lastDrawNumbers.includes(num) && !coldestNumbers.includes(num) && !lowestBlockNumbers.includes(num));

    console.log(`🎯 一期多注策略：排除上期、冷門、低頻區塊`);
    console.log(`🎯 排除上期號碼 (20個): ${lastDrawNumbers.join(', ')}`);
    console.log(`🎯 排除最冷門號碼 (10個): ${coldestNumbers.join(', ')}`);
    console.log(`🎯 排除低頻區塊號碼 (${lowestBlockNumbers.length}個): ${lowestBlockNumbers.join(', ')}`);
    console.log(`🎯 可選號碼池 (${availablePool.length}個): ${availablePool.join(', ')}`);

    const hot = sortedByFreq.filter(n => availablePool.includes(n)).slice(0, 15);
    const cold = sortedByFreq.filter(n => availablePool.includes(n)).slice(-20);

    let strategyPrompt = '';
    
    switch (strategy) {
      case 'hot':
        strategyPrompt = `請使用「熱門策略」分析方法。
        
🎯 純熱門策略重點：
- ${stars <= 4 ? '僅從 Top 8 熱門號碼中選擇並排列組合' : '僅從 Top 10 熱門號碼中選擇並排列組合'}
- 不要混搭冷門或連號，只使用純熱門號碼
- 每注就是從熱門號碼池中排列組合不同的組合
- 不同注之間可以有重複號碼，透過不同排列增加覆蓋率
- 目標：至少命中${Math.max(2, Math.floor(stars * 0.6))}個號碼

🎯 號碼池限制：
- ${stars <= 4 ? `可選號碼池（僅限這 8 個號碼）: ${hot.slice(0, 8).join(', ')}` : `可選號碼池（僅限這 10 個號碼）: ${hot.slice(0, 10).join(', ')}`}
- ⚠️ **絕對不可以選擇這個號碼池以外的任何號碼**
- ⚠️ 只能從上述 ${stars <= 4 ? '8' : '10'} 個熱門號碼中進行排列組合

🎯 排除規則：
- ⚠️ 必須排除上一期的 20 個中獎號碼：${lastDrawNumbers.join(', ')}
- ⚠️ 必須排除最冷門的 20 個號碼（含0次號碼）
- ⚠️ 必須排除頻率最低的兩個區塊號碼

範例（${stars}星）：
${stars === 3 ? `- [${hot.slice(0, 3).join(',')}]
- [${hot.slice(1, 4).join(',')}]
- [${hot.slice(2, 5).join(',')}]` : ''}
${stars === 4 ? `- [${hot.slice(0, 4).join(',')}]
- [${hot.slice(1, 5).join(',')}]
- [${hot.slice(2, 6).join(',')}]` : ''}
${stars === 5 ? `- [${hot.slice(0, 5).join(',')}]
- [${hot.slice(1, 6).join(',')}]
- [${hot.slice(2, 7).join(',')}]` : ''}
${stars === 6 ? `- [${hot.slice(0, 6).join(',')}]
- [${hot.slice(1, 7).join(',')}]
- [${hot.slice(2, 8).join(',')}]` : ''}`;
        break;
      case 'consecutive':
        strategyPrompt = `請使用「連號策略」分析方法。
        
🎯 策略重點：
- 每注包含1-2組連號
- 其他號碼可以選擇熱門號碼或分散選擇
- 不同注之間可以有重複號碼，用不同連號組合
- 連號通常只會部分命中，因此搭配策略很重要
- 目標：至少命中${Math.max(2, Math.floor(stars * 0.6))}個號碼

🎯 排除規則：
- ❌ 不排除上一期的號碼（連號可能持續出現）
- ⚠️ 必須排除最冷門的 20 個號碼（含0次號碼）
- ⚠️ 必須排除頻率最低的兩個區塊號碼`;
        break;
      default:
        strategyPrompt = `請根據最近${periods}期的開獎資料，使用你的AI智慧分析。
        
🎯 AI 智慧混搭策略重點：
- 目標：至少命中${Math.max(2, Math.floor(stars * 0.6))}個號碼
- 可以自由混搭以下元素：
  1. 熱門號碼（高頻號碼）
  2. 次冷門號碼（不是最冷的20個）
  3. 不規則連號（例如：12,13 或 25,26,27）
- 每注可以使用不同的混搭比例
- 為每一注設計獨特的組合策略
- 不同注之間可以有重複號碼

🎯 排除規則：
- ⚠️ 必須排除上一期的 20 個中獎號碼：${lastDrawNumbers.join(', ')}
- ⚠️ 必須排除最冷門的 15 個號碼（含0次號碼）
- ⚠️ 必須排除頻率最低的兩個區塊號碼`;
  }

    return `${strategyPrompt}

🚫 核心約束條件：
- 上一期中獎號碼（${strategy === 'consecutive' ? '不需排除' : '必須排除'}，共20個）：${lastDrawNumbers.join(', ')}
- 最冷門號碼（必須排除，共20個，含0次號碼）：${coldestNumbers.join(', ')}
- 最低頻區塊號碼（必須排除）：${lowestBlockNumbers.join(', ')}
- 可選號碼池（僅限從這些號碼中選擇）：${availablePool.join(', ')}

📊 統計理由：
- 連續兩期重複號碼平均約 5 個
- 最冷門號碼（含0次）出現機率極低
- 從優質號碼池中選擇可大幅提高命中率

歷史資料摘要：
- 分析期數：最近 ${periods} 期
- 需要推薦：${bets} 組號碼
- 每組號碼數：${stars} 個
- 號碼範圍：可選號碼池的號碼（已排除${strategy === 'consecutive' ? '最冷門20個+最低頻區塊' : '上期20個+最冷門20個+最低頻區塊'}）
- 實戰目標：每組至少命中 ${Math.max(2, Math.floor(stars * 0.6))} 個號碼

重要原則：
1. ⚠️ ${strategy === 'consecutive' ? '絕對不可選擇最冷門20個號碼和最低頻區塊號碼' : '絕對不可選擇上期中獎號碼、最冷門20個號碼和最低頻區塊號碼'}，必須只從可選號碼池中選擇
2. 💡 不同注之間可以有重複號碼（這樣可以增加覆蓋範圍）
3. 每組號碼請按從小到大排序
${strategy === 'hot' 
  ? '4. 🎯 熱門策略：只選擇高頻號碼，不要混搭冷門或連號' 
  : strategy === 'consecutive'
  ? '4. 🎯 連號策略：可包含1-2組連號，其他號碼可選熱門或分散'
  : '4. 🎯 AI建議策略：可以混搭熱門、次冷門、不規則連號（例如：12,13 或 45,46,47）'}
5. 🎯 實戰觀察：3星通常只能3中2，因此選號應更注重覆蓋範圍
6. 💡 為每一注設計${strategy === 'hot' ? '不同的熱門組合' : strategy === 'consecutive' ? '不同的連號組合' : '不同的混搭組合'}

請以JSON格式返回：
{
  "bets": [
    [第1組的${stars}個號碼（從小到大排序）],
    [第2組的${stars}個號碼（從小到大排序）],
    ${bets > 2 ? '...' : ''}
  ],
  "reasoning": "簡短的分析理由（150字以內），說明你選擇了什麼策略${strategy === 'ai' ? '（熱門、次冷門、不規則連號的混搭比例）' : strategy === 'consecutive' ? '（連號組合及其他號碼的搭配）' : ''}，為何這些組合有較高的部分命中機率"
}`;
  }
}

function extractNumbersFromText(text: string): number[] {
  const matches = text.match(/\b([1-7]?\d|80)\b/g);
  if (!matches) return [];
  
  const numbers = matches
    .map(n => parseInt(n))
    .filter(n => n >= 1 && n <= 80);
  
  return Array.from(new Set(numbers));
}

function generateFallbackNumbers(count: number, excludeNumbers: number[] = []): number[] {
  const availablePool = Array.from({ length: 80 }, (_, i) => i + 1)
    .filter(num => !excludeNumbers.includes(num));
  
  const numbers: number[] = [];
  while (numbers.length < count && availablePool.length > 0) {
    const randomIndex = Math.floor(Math.random() * availablePool.length);
    const num = availablePool[randomIndex];
    if (!numbers.includes(num)) {
      numbers.push(num);
      availablePool.splice(randomIndex, 1);
    }
  }
  return numbers.sort((a, b) => a - b);
}

function generateFallbackBets(betsCount: number, starsCount: number, excludeNumbers: number[] = []): number[][] {
  const availablePool = Array.from({ length: 80 }, (_, i) => i + 1)
    .filter(num => !excludeNumbers.includes(num));
  
  const allBets: number[][] = [];
  
  for (let i = 0; i < betsCount; i++) {
    const betNumbers: number[] = [];
    const poolCopy = [...availablePool]; // 每注使用獨立的號碼池副本
    
    while (betNumbers.length < starsCount && poolCopy.length > 0) {
      const randomIndex = Math.floor(Math.random() * poolCopy.length);
      const num = poolCopy[randomIndex];
      betNumbers.push(num);
      poolCopy.splice(randomIndex, 1); // 在當前注內不重複
    }
    
    allBets.push(betNumbers.sort((a, b) => a - b));
  }
  
  return allBets;
}

// 計算頻率最低的兩個區塊的號碼
function calculateLowestBlockNumbers(historicalData: any[], periods: number): number[] {
  const frequency: { [key: number]: number } = {};
  for (let i = 1; i <= 80; i++) {
    frequency[i] = 0;
  }
  
  historicalData.slice(0, periods).forEach((d: any) => {
    d.numbers.forEach((num: number) => {
      frequency[num] = (frequency[num] || 0) + 1;
    });
  });
  
  const blocks: Array<{ range: string; numbers: number[]; totalFreq: number; hotCount: number }> = [];
  
  // 計算每個區塊（4個號碼一組）
  for (let i = 1; i <= 80; i += 4) {
    const blockNumbers = [i, i+1, i+2, i+3].filter(n => n <= 80);
    const totalFreq = blockNumbers.reduce((sum, n) => sum + (frequency[n] || 0), 0);
    
    // 計算區塊內熱門號碼數量（頻率高於平均值的號碼）
    const avgFreq = totalFreq / blockNumbers.length;
    const hotCount = blockNumbers.filter(n => frequency[n] >= avgFreq).length;
    
    blocks.push({
      range: `${i}-${Math.min(i + 3, 80)}`,
      numbers: blockNumbers,
      totalFreq,
      hotCount
    });
  }
  
  // 排序：先按總頻率，如果相同則按熱門號碼數量
  blocks.sort((a, b) => {
    if (a.totalFreq !== b.totalFreq) {
      return a.totalFreq - b.totalFreq;  // 頻率低的在前
    }
    return a.hotCount - b.hotCount;  // 熱門號碼少的在前
  });
  
  // 取最低的兩個區塊
  const lowestTwoBlocks = blocks.slice(0, 2);
  const excludedNumbers = lowestTwoBlocks.flatMap(block => block.numbers);
  
  console.log(`🎯 後端計算：排除頻率最低的兩個區塊`);
  lowestTwoBlocks.forEach(block => {
    console.log(`   ${block.range}: 總頻率=${block.totalFreq}, 熱門數=${block.hotCount}`);
  });
  
  return excludedNumbers;
}
