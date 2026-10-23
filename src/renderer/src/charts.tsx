import { useEffect, useId, useRef } from 'react'
import * as echarts from 'echarts'

export function BarChart(props: { labels: string[]; values: number[]; color: string; summary: string }) {
  const host = useRef<HTMLDivElement | null>(null)
  const summaryId = useId()
  useEffect(() => {
    const node = host.current
    if (!node) return
    const chart = echarts.init(node, undefined, { renderer: 'svg' })
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    chart.setOption({
      animation: !reduced,
      grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', axisLabel: { color: '#d7cbbd', fontSize: 12 } },
      yAxis: { type: 'category', data: props.labels, axisLabel: { color: '#f6f1e7', fontSize: 13, width: 120, overflow: 'truncate' }, inverse: true },
      series: [{ type: 'bar', data: props.values, itemStyle: { color: props.color, borderRadius: 4 }, barMaxWidth: 18 }]
    })
    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.dispose()
    }
  }, [props.labels, props.values, props.color])
  return (
    <>
      <div ref={host} className="chart" role="img" aria-describedby={summaryId} />
      <p id={summaryId} className="summary">{props.summary}</p>
    </>
  )
}
