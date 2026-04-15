import requests
import json
import os
from datetime import datetime
import time

def update_all_journals_metrics():
    # 核心配置字典：左侧为 OJS 路由标识（需与网址路径一致），右侧为 OpenAlex 检索语法
    journals_config = {
        # --- 已获取高精度 OpenAlex ID 的期刊 ---
        "afs": "openalex:S5407051439",           # AI & Future Society
        "jesa": "openalex:S5407051582",          # Journal of Engineering Systems and Applications
        "files": "openalex:S5407047583",         # Global Review of Humanities, Arts, and Society (GRHAS)
        "HealthNexus": "openalex:S5407052766",    # Health Nexus
        "jlpcs": "openalex:S5407047588",         # Journal of Law, Psychology, and Communication Studies
        "pemr": "openalex:S5407051438",          # PoliEcoM Administration Review
        "rggd": "openalex:S5407054085",          # Rural Governance and Green Development
        "Resonance": "openalex:S5407051440",     # Resonance: Journal of Global Music Studies
        "Silence": "openalex:S7407054022",       # Silence
        "tts": "openalex:S5407052764",           # Three Teachings Studies
        "jscc": "openalex:S7407056239",          # Journal of Social Cognition and Communication
        
        # --- 使用全名检索的期刊（待 OpenAlex 进一步索引或分配 ID） ---
        "cprt": "display_name.search:Comparative Philosophy and Religious Traditions",
        "csgs": "display_name.search:Climate Sustainability & Global Systems",
        "cssr": "display_name.search:Computational Social Sciences Review",
        "gppgr": "display_name.search:Global Public Policy & Governance Review",
        "jdes": "display_name.search:Journal of Dance and Embodied Structure",
        "irels": "display_name.search:International Review of Education and Learning Sciences",
        "pfr": "display_name.search:Panorama Frontier Review"
    }
    
    # 从系统环境变量中安全读取邮箱，用于进入 OpenAlex 礼貌池
    developer_email = os.environ.get('OPENALEX_EMAIL', '')
    
    headers = {}
    if developer_email:
        headers['User-Agent'] = f'mailto:{developer_email}'
    else:
        print("[警告] 未检测到 OPENALEX_EMAIL 环境变量，将使用匿名模式请求（容易触发限流）。")
        
    aggregated_metrics = {
        "last_updated": datetime.utcnow().strftime("%Y-%m-%d")
    }

    print("启动 Panorama 集团期刊矩阵 OpenAlex 指标同步...")
    print("-" * 50)
    
    for journal_path, filter_query in journals_config.items():
        base_url = f"https://api.openalex.org/sources?filter={filter_query}"
        
        try:
            response = requests.get(base_url, headers=headers)
            response.raise_for_status()
            data = response.json()
            
            if data['meta']['count'] > 0:
                source = data['results'][0]
                summary = source.get('summary_stats', {})
                
                aggregated_metrics[journal_path] = {
                    "2yr_mean_citedness": round(summary.get('2yr_mean_citedness', 0), 2),
                    "h_index": summary.get('h_index', 0),
                    "i10_index": summary.get('i10_index', 0),
                    "works_count": source.get('works_count', 0)
                }
                print(f"[成功] {journal_path:<15} 数据已更新 (H-Index: {summary.get('h_index', 0)})")
            else:
                print(f"[未收录] {journal_path:<13} 暂无有效数据。")
                aggregated_metrics[journal_path] = None
                
        except Exception as e:
            print(f"[异常] {journal_path:<15} 请求失败: {str(e)[:50]}...")
            
        # 强制休眠 0.5 秒，严格遵守学术开放 API 的速率规范
        time.sleep(0.5)

    print("-" * 50)
    
    # 寻址到仓库根目录，输出 JSON 文件
    # __file__ 是当前脚本路径，dirname 取父目录
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    output_path = os.path.join(root_dir, 'all_journals_metrics.json')
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(aggregated_metrics, f, indent=4)
        
    print(f"同步流程完成，数据已持久化至: all_journals_metrics.json")

if __name__ == "__main__":
    update_all_journals_metrics()
