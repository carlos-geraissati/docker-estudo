# Automação F5: Ansible vs Python — Comparação Completa

## Índice

1. [Introdução](#introdução)
2. [Ansible para Automação F5](#ansible-para-automação-f5)
3. [Python para Automação F5](#python-para-automação-f5)
4. [Tabela Comparativa](#tabela-comparativa)
5. [Análise de Problemas Comuns no F5](#análise-de-problemas-comuns-no-f5)
6. [Caso Real: Monitoramento Acionando Automação para Recuperação do Ambiente](#caso-real-monitoramento-acionando-automação-para-recuperação-do-ambiente)
7. [Conclusão e Recomendações](#conclusão-e-recomendações)

---

## Introdução

O F5 BIG-IP é uma das plataformas mais utilizadas para gerenciamento de tráfego de aplicações (ADC), balanceamento de carga, WAF e SSL offloading. Automatizar tarefas no F5 é essencial para ambientes de larga escala, e as duas ferramentas mais populares para isso são **Ansible** e **Python**.

Este documento compara as duas abordagens com exemplos reais, vantagens, desvantagens e um caso completo de monitoramento + automação para recuperação de ambiente.

---

## Ansible para Automação F5

### O que é?

Ansible é uma ferramenta de automação declarativa (Infrastructure as Code) que usa YAML para definir o estado desejado da infraestrutura. A F5 fornece módulos oficiais via a collection `f5networks.f5_modules`.

### Instalação

```bash
# Instalar Ansible
pip install ansible

# Instalar a collection F5
ansible-galaxy collection install f5networks.f5_modules
```

### Exemplo Prático: Criar um Virtual Server

```yaml
# playbook_criar_vs.yml
---
- name: Gerenciar F5 BIG-IP
  hosts: f5_devices
  connection: local
  gather_facts: false

  vars:
    provider:
      server: "192.168.1.245"
      user: "admin"
      password: "{{ vault_f5_password }}"
      validate_certs: false

  tasks:
    - name: Criar Pool
      f5networks.f5_modules.bigip_pool:
        provider: "{{ provider }}"
        name: "pool_app_producao"
        lb_method: "round-robin"
        monitors:
          - /Common/http
        state: present

    - name: Adicionar membros ao Pool
      f5networks.f5_modules.bigip_pool_member:
        provider: "{{ provider }}"
        pool: "pool_app_producao"
        host: "{{ item.host }}"
        port: "{{ item.port }}"
        state: present
      loop:
        - { host: "10.10.1.10", port: 80 }
        - { host: "10.10.1.11", port: 80 }
        - { host: "10.10.1.12", port: 80 }

    - name: Criar Virtual Server
      f5networks.f5_modules.bigip_virtual_server:
        provider: "{{ provider }}"
        name: "vs_app_producao"
        destination: "200.200.200.10"
        port: 443
        pool: "pool_app_producao"
        snat: "automap"
        profiles:
          - http
          - name: clientssl
            context: client-side
        state: present
```

### Exemplo Prático: Desabilitar um Node para Manutenção

```yaml
# playbook_manutencao_node.yml
---
- name: Colocar node em manutenção
  hosts: f5_devices
  connection: local
  gather_facts: false

  tasks:
    - name: Desabilitar node (Forced Offline)
      f5networks.f5_modules.bigip_node:
        provider: "{{ provider }}"
        name: "10.10.1.12"
        state: forced_offline

    - name: Aguardar conexões ativas drenarem
      f5networks.f5_modules.bigip_pool_member:
        provider: "{{ provider }}"
        pool: "pool_app_producao"
        host: "10.10.1.12"
        port: 80
        state: forced_offline
      register: result

    - name: Verificar status do node
      f5networks.f5_modules.bigip_node:
        provider: "{{ provider }}"
        name: "10.10.1.12"
      register: node_status

    - debug:
        msg: "Node status: {{ node_status }}"
```

### Vantagens do Ansible

| Vantagem | Descrição |
|----------|-----------|
| **Declarativo** | Você define o estado desejado, não os passos. O Ansible garante idempotência |
| **Sem agente** | Não precisa instalar nada no F5, usa API REST por baixo |
| **Curva de aprendizado baixa** | YAML é simples de ler e escrever, mesmo para quem não é desenvolvedor |
| **Módulos oficiais F5** | Collection mantida pela própria F5 Networks com suporte oficial |
| **Integração com CI/CD** | Fácil de integrar com Jenkins, GitLab CI, GitHub Actions |
| **Vault integrado** | Ansible Vault para gerenciar credenciais de forma segura |
| **Auditabilidade** | Playbooks versionados em Git = histórico completo de mudanças |
| **Reutilização** | Roles e collections permitem reaproveitar código entre projetos |

### Desvantagens do Ansible

| Desvantagem | Descrição |
|-------------|-----------|
| **Lógica limitada** | Loops complexos, condicionais avançadas e tratamento de erros são difíceis em YAML |
| **Performance** | Mais lento que scripts Python diretos, especialmente com muitos dispositivos |
| **Debugging difícil** | Erros em playbooks YAML podem ser crípticos e difíceis de rastrear |
| **Cobertura parcial** | Nem todas as funcionalidades do F5 têm módulo Ansible dedicado |
| **Flexibilidade limitada** | Para workflows muito customizados, YAML se torna confuso e verboso |
| **Dependência de módulos** | Se o módulo tem bug, você depende do mantenedor para corrigir |

---

## Python para Automação F5

### O que é?

Python oferece acesso direto à API REST iControl do F5 BIG-IP, permitindo controle total sobre todas as funcionalidades. A biblioteca principal é a `f5-sdk` ou chamadas diretas via `requests`.

### Instalação

```bash
# SDK oficial (legado, mas ainda funcional)
pip install f5-sdk

# Alternativa moderna: usar requests diretamente
pip install requests urllib3
```

### Exemplo Prático: Criar um Virtual Server

```python
#!/usr/bin/env python3
"""
Script para criar Virtual Server no F5 BIG-IP via API REST iControl.
"""

import requests
import urllib3
import json
import sys

# Desabilitar warnings de SSL para ambientes lab
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

class F5Manager:
    def __init__(self, host, username, password):
        self.host = host
        self.base_url = f"https://{host}/mgmt/tm"
        self.session = requests.Session()
        self.session.auth = (username, password)
        self.session.verify = False
        self.session.headers.update({
            'Content-Type': 'application/json'
        })
        # Obter token de autenticação
        self._get_auth_token()

    def _get_auth_token(self):
        """Autentica via token para melhor performance."""
        url = f"https://{self.host}/mgmt/shared/authn/login"
        payload = {
            "username": self.session.auth[0],
            "password": self.session.auth[1],
            "loginProviderName": "tmos"
        }
        resp = requests.post(url, json=payload, verify=False)
        resp.raise_for_status()
        token = resp.json()['token']['token']
        self.session.headers.update({
            'X-F5-Auth-Token': token
        })
        self.session.auth = None  # Usar apenas token

    def criar_pool(self, nome, metodo_lb="round-robin", monitor="/Common/http"):
        """Cria um pool de servidores."""
        url = f"{self.base_url}/ltm/pool"
        payload = {
            "name": nome,
            "loadBalancingMode": metodo_lb,
            "monitor": monitor
        }
        resp = self.session.post(url, json=payload)
        if resp.status_code == 409:
            print(f"[INFO] Pool '{nome}' já existe.")
            return True
        resp.raise_for_status()
        print(f"[OK] Pool '{nome}' criado com sucesso.")
        return True

    def adicionar_membro_pool(self, pool, host, porta):
        """Adiciona um membro ao pool."""
        url = f"{self.base_url}/ltm/pool/~Common~{pool}/members"
        payload = {
            "name": f"{host}:{porta}",
            "address": host
        }
        resp = self.session.post(url, json=payload)
        if resp.status_code == 409:
            print(f"[INFO] Membro {host}:{porta} já existe no pool.")
            return True
        resp.raise_for_status()
        print(f"[OK] Membro {host}:{porta} adicionado ao pool '{pool}'.")
        return True

    def criar_virtual_server(self, nome, destino, porta, pool, perfis=None):
        """Cria um Virtual Server."""
        url = f"{self.base_url}/ltm/virtual"
        payload = {
            "name": nome,
            "destination": f"/Common/{destino}:{porta}",
            "pool": f"/Common/{pool}",
            "sourceAddressTranslation": {"type": "automap"},
            "profiles": perfis or [
                {"name": "http"},
                {"name": "clientssl", "context": "clientside"}
            ]
        }
        resp = self.session.post(url, json=payload)
        if resp.status_code == 409:
            print(f"[INFO] VS '{nome}' já existe.")
            return True
        resp.raise_for_status()
        print(f"[OK] Virtual Server '{nome}' criado com sucesso.")
        return True

    def listar_pools(self):
        """Lista todos os pools e seus membros."""
        url = f"{self.base_url}/ltm/pool?expandSubcollections=true"
        resp = self.session.get(url)
        resp.raise_for_status()
        pools = resp.json().get('items', [])
        for pool in pools:
            print(f"\nPool: {pool['name']} | LB: {pool.get('loadBalancingMode', 'N/A')}")
            members = pool.get('membersReference', {}).get('items', [])
            for m in members:
                status = m.get('state', 'unknown')
                print(f"  └─ {m['name']} | Status: {status}")
        return pools

    def verificar_status_membro(self, pool, membro):
        """Verifica o status de um membro específico do pool."""
        url = f"{self.base_url}/ltm/pool/~Common~{pool}/members/~Common~{membro}/stats"
        resp = self.session.get(url)
        resp.raise_for_status()
        stats = resp.json()
        # Extrair métricas relevantes
        entries = stats.get('entries', {})
        for key, value in entries.items():
            nested = value.get('nestedStats', {}).get('entries', {})
            status = nested.get('status.availabilityState', {}).get('description', 'unknown')
            cur_conns = nested.get('serverside.curConns', {}).get('value', 0)
            total_conns = nested.get('serverside.totConns', {}).get('value', 0)
            return {
                'status': status,
                'conexoes_ativas': cur_conns,
                'total_conexoes': total_conns
            }

    def forcar_offline(self, pool, membro):
        """Força um membro do pool offline."""
        url = f"{self.base_url}/ltm/pool/~Common~{pool}/members/~Common~{membro}"
        payload = {
            "session": "user-disabled",
            "state": "user-down"
        }
        resp = self.session.put(url, json=payload)
        resp.raise_for_status()
        print(f"[OK] Membro {membro} forçado offline no pool '{pool}'.")
        return True

    def habilitar_membro(self, pool, membro):
        """Habilita um membro do pool."""
        url = f"{self.base_url}/ltm/pool/~Common~{pool}/members/~Common~{membro}"
        payload = {
            "session": "user-enabled",
            "state": "user-up"
        }
        resp = self.session.put(url, json=payload)
        resp.raise_for_status()
        print(f"[OK] Membro {membro} habilitado no pool '{pool}'.")
        return True


if __name__ == "__main__":
    # Configuração
    f5 = F5Manager(
        host="192.168.1.245",
        username="admin",
        password="SenhaSegura123"  # Em produção, use variáveis de ambiente!
    )

    # Criar infraestrutura
    f5.criar_pool("pool_app_producao", metodo_lb="round-robin")
    for server in [("10.10.1.10", 80), ("10.10.1.11", 80), ("10.10.1.12", 80)]:
        f5.adicionar_membro_pool("pool_app_producao", server[0], server[1])
    f5.criar_virtual_server(
        nome="vs_app_producao",
        destino="200.200.200.10",
        porta=443,
        pool="pool_app_producao"
    )

    # Listar e verificar
    f5.listar_pools()
```

### Exemplo Prático: Coletor de Métricas

```python
#!/usr/bin/env python3
"""
Coletor de métricas do F5 BIG-IP para monitoramento.
Exporta dados para Prometheus/Grafana ou salva em arquivo.
"""

import requests
import urllib3
import json
import time
from datetime import datetime

urllib3.disable_warnings()


def coletar_metricas_vs(host, token, vs_name):
    """Coleta métricas de um Virtual Server."""
    url = f"https://{host}/mgmt/tm/ltm/virtual/~Common~{vs_name}/stats"
    headers = {'X-F5-Auth-Token': token}
    resp = requests.get(url, headers=headers, verify=False)
    resp.raise_for_status()

    stats = resp.json()
    metricas = {}

    for key, value in stats.get('entries', {}).items():
        nested = value.get('nestedStats', {}).get('entries', {})
        metricas = {
            'timestamp': datetime.now().isoformat(),
            'virtual_server': vs_name,
            'status': nested.get('status.availabilityState', {}).get('description'),
            'conexoes_ativas': nested.get('clientside.curConns', {}).get('value', 0),
            'total_conexoes': nested.get('clientside.totConns', {}).get('value', 0),
            'bytes_in': nested.get('clientside.bitsIn', {}).get('value', 0),
            'bytes_out': nested.get('clientside.bitsOut', {}).get('value', 0),
            'requests_total': nested.get('totRequests', {}).get('value', 0),
            'status_enabled': nested.get('status.enabledState', {}).get('description'),
        }
    return metricas


def coletar_metricas_pool(host, token, pool_name):
    """Coleta métricas de um Pool e seus membros."""
    url = f"https://{host}/mgmt/tm/ltm/pool/~Common~{pool_name}/members/stats"
    headers = {'X-F5-Auth-Token': token}
    resp = requests.get(url, headers=headers, verify=False)
    resp.raise_for_status()

    membros = []
    for key, value in resp.json().get('entries', {}).items():
        nested = value.get('nestedStats', {}).get('entries', {})
        membro = {
            'nome': nested.get('nodeName', {}).get('description', 'unknown'),
            'status': nested.get('status.availabilityState', {}).get('description'),
            'conexoes_ativas': nested.get('serverside.curConns', {}).get('value', 0),
            'total_conexoes': nested.get('serverside.totConns', {}).get('value', 0),
            'monitor_status': nested.get('monitorStatus', {}).get('description'),
        }
        membros.append(membro)
    return membros


def monitoramento_continuo(host, token, vs_name, pool_name, intervalo=30):
    """Loop de monitoramento contínuo."""
    print(f"[MONITOR] Iniciando monitoramento contínuo (intervalo: {intervalo}s)")
    while True:
        try:
            vs_stats = coletar_metricas_vs(host, token, vs_name)
            pool_stats = coletar_metricas_pool(host, token, pool_name)

            print(f"\n{'='*60}")
            print(f"[{vs_stats['timestamp']}] VS: {vs_name}")
            print(f"  Status: {vs_stats['status']} | Conexões: {vs_stats['conexoes_ativas']}")
            print(f"  Requests Total: {vs_stats['requests_total']}")

            for membro in pool_stats:
                status_icon = "🟢" if membro['status'] == 'available' else "🔴"
                print(f"  {status_icon} {membro['nome']} | "
                      f"Status: {membro['status']} | "
                      f"Conns: {membro['conexoes_ativas']}")

            time.sleep(intervalo)

        except KeyboardInterrupt:
            print("\n[MONITOR] Monitoramento encerrado.")
            break
        except Exception as e:
            print(f"[ERRO] {e}")
            time.sleep(intervalo)
```

### Vantagens do Python

| Vantagem | Descrição |
|----------|-----------|
| **Controle total** | Acesso completo a 100% da API REST iControl |
| **Lógica complexa** | Loops, condicionais, tratamento de erros, retry, tudo nativo |
| **Performance** | Execução mais rápida, especialmente com async/aiohttp |
| **Debugging avançado** | PDB, logging, stack traces — debugging profissional |
| **Integração com tudo** | Prometheus, Grafana, Slack, PagerDuty, bancos de dados |
| **Manipulação de dados** | Parse de JSON, XML, regex — tratamento avançado de dados |
| **Testes unitários** | pytest, unittest para testar automações antes de rodar |
| **Bibliotecas ricas** | requests, paramiko, netmiko, jinja2 — ecossistema imenso |

### Desvantagens do Python

| Desvantagem | Descrição |
|-------------|-----------|
| **Curva de aprendizado** | Requer conhecimento de programação |
| **Mais código** | Tarefas simples exigem mais linhas de código que Ansible |
| **Manutenção** | Scripts podem se tornar complexos e difíceis de manter sem boas práticas |
| **Sem idempotência nativa** | Você precisa implementar verificações de estado manualmente |
| **Sem inventário nativo** | Gerenciamento de dispositivos deve ser implementado manualmente |
| **Segurança de credenciais** | Precisa implementar gestão de secrets (dotenv, vault, etc.) |

---

## Tabela Comparativa

| Critério | Ansible | Python |
|----------|---------|--------|
| **Curva de aprendizado** | Baixa (YAML) | Média-Alta (programação) |
| **Idempotência** | Nativa | Manual |
| **Performance** | Moderada | Alta |
| **Flexibilidade** | Limitada | Total |
| **Cobertura API F5** | ~70% | 100% |
| **Tratamento de erros** | Básico | Avançado |
| **Debugging** | Difícil | Fácil |
| **CI/CD** | Excelente | Bom |
| **Auditabilidade** | Excelente (YAML legível) | Boa (código) |
| **Manutenção** | Fácil para tarefas simples | Requer boas práticas |
| **Monitoramento** | Limitado | Excelente |
| **Equipe NOC/Infra** | Ideal | Requer treinamento |
| **Equipe DevOps** | Bom | Excelente |

### Quando usar cada um?

| Cenário | Recomendação |
|---------|-------------|
| Provisionar Virtual Servers em massa | **Ansible** |
| Gerenciar configurações padronizadas | **Ansible** |
| Monitoramento em tempo real com alertas | **Python** |
| Automação de recuperação inteligente | **Python** |
| Pipeline CI/CD de infraestrutura | **Ansible** |
| Relatórios customizados | **Python** |
| Equipe sem experiência em programação | **Ansible** |
| Integração com ITSM (ServiceNow, etc.) | **Python** |
| **Melhor abordagem** | **Ansible + Python juntos** |

---

## Análise de Problemas Comuns no F5

### 1. Pool Member Down

**Sintoma:** Membro do pool aparece com status vermelho (offline).

**Diagnóstico via CLI (tmsh):**
```bash
# Verificar status do pool
tmsh show ltm pool pool_app_producao members

# Verificar monitor associado
tmsh list ltm pool pool_app_producao monitor

# Verificar logs do monitor
tail -f /var/log/ltm | grep pool_app_producao

# Testar conectividade com o servidor
curl -v http://10.10.1.10:80/health
```

**Diagnóstico via API Python:**
```python
def diagnosticar_pool_member_down(f5, pool_name):
    """Diagnóstico automatizado de pool member down."""
    membros = coletar_metricas_pool(f5.host, token, pool_name)

    for membro in membros:
        if membro['status'] != 'available':
            print(f"\n[ALERTA] Membro DOWN detectado: {membro['nome']}")
            print(f"  Monitor Status: {membro['monitor_status']}")
            print(f"  Última conexão ativa: {membro['conexoes_ativas']}")

            # Causas comuns:
            print("\n  Possíveis causas:")
            print("  1. Serviço da aplicação parado no servidor backend")
            print("  2. Firewall bloqueando a porta do health check")
            print("  3. Monitor configurado incorretamente (URL, porta, string esperada)")
            print("  4. Servidor backend com alta latência (timeout do monitor)")
            print("  5. Problema de rede entre F5 e servidor backend (VLAN/rota)")
```

**Causas comuns e soluções:**

| Causa | Solução |
|-------|---------|
| Serviço parado no backend | Reiniciar serviço (systemctl restart app) |
| Firewall bloqueando | Verificar regras de FW entre F5 e backend |
| Monitor incorreto | Ajustar send/receive string do monitor |
| Timeout do monitor | Aumentar intervalo/timeout ou otimizar backend |
| Problema de rede | Verificar VLANs, rotas e self IPs |

---

### 2. Virtual Server Não Responde

**Sintoma:** Usuários não conseguem acessar a aplicação via VIP.

**Diagnóstico:**
```bash
# Verificar se o VS está habilitado e disponível
tmsh show ltm virtual vs_app_producao

# Verificar se há membros disponíveis no pool
tmsh show ltm pool pool_app_producao

# Verificar SNAT - se há portas SNAT disponíveis
tmsh show ltm snatpool

# Verificar conexões
tmsh show sys connection cs-server-addr 200.200.200.10

# Verificar se perfil SSL está correto
tmsh list ltm virtual vs_app_producao profiles

# Testar a partir do F5
curl -k https://200.200.200.10/ --resolve app.empresa.com:443:200.200.200.10
```

**Checklist de investigação:**

```
[ ] VS está enabled e available?
[ ] Pool tem membros available?
[ ] Perfil SSL correto e certificado válido?
[ ] SNAT configurado (automap ou snatpool)?
[ ] Regras de firewall permitem tráfego ao VIP?
[ ] DNS resolve para o IP correto do VIP?
[ ] Self IP e VLAN configurados corretamente?
[ ] Persistence profile está correto?
[ ] iRules não estão bloqueando tráfego?
```

---

### 3. Alta Utilização de CPU/Memória

**Sintoma:** F5 lento, dashboard mostrando CPU > 80%.

**Diagnóstico:**
```bash
# CPU e memória
tmsh show sys performance throughput
tmsh show sys performance connections
tmsh show sys memory

# Processos consumindo CPU
top -bn1 | head -20

# Conexões ativas
tmsh show sys connection count

# Verificar se há iRules pesadas
tmsh show ltm rule all stats
```

**Script Python para monitorar performance:**
```python
def monitorar_performance(f5_host, token):
    """Monitora performance do F5."""
    url = f"https://{f5_host}/mgmt/tm/sys/performance/all-stats"
    headers = {'X-F5-Auth-Token': token}
    resp = requests.get(url, headers=headers, verify=False)

    stats = resp.json()
    entries = stats.get('entries', {})

    for key, value in entries.items():
        nested = value.get('nestedStats', {}).get('entries', {})
        for metric_name, metric_data in nested.items():
            desc = metric_data.get('description', '')
            if any(word in metric_name.lower() for word in ['cpu', 'memory', 'throughput']):
                print(f"  {metric_name}: {desc}")
```

**Causas e soluções:**

| Causa | Solução |
|-------|---------|
| iRules ineficientes | Otimizar/reescrever iRules com lógica mais simples |
| Excesso de conexões | Verificar connection limits e timeout profiles |
| SSL handshakes excessivos | Implementar SSL session reuse/caching |
| Ataque DDoS | Ativar DoS protection profiles |
| Muitos logs habilitados | Reduzir verbosidade de logging |

---

### 4. Problemas de Persistência de Sessão

**Sintoma:** Usuários perdem sessão/login durante navegação.

**Diagnóstico:**
```bash
# Verificar persistence profile
tmsh list ltm virtual vs_app_producao persist

# Ver tabela de persistência ativa
tmsh show ltm persistence persist-records

# Verificar se cookie está sendo inserido
curl -v -k https://200.200.200.10/ 2>&1 | grep -i "set-cookie"
```

**Causas e soluções:**

| Causa | Solução |
|-------|---------|
| Sem persistence profile | Adicionar cookie ou source_addr persistence |
| Cookie errado | Verificar nome e path do cookie |
| Timeout muito curto | Aumentar persistence timeout |
| Fallback não configurado | Adicionar fallback persistence (source_addr) |
| Membros do pool mudando | Usar priority group activation |

---

### 5. Certificado SSL Expirado

**Sintoma:** Navegador mostra erro de certificado, ou conexões SSL falhando.

**Diagnóstico e automação:**
```python
def verificar_certificados(f5_host, token, dias_alerta=30):
    """Verifica certificados próximos da expiração."""
    url = f"https://{f5_host}/mgmt/tm/sys/crypto/cert"
    headers = {'X-F5-Auth-Token': token}
    resp = requests.get(url, headers=headers, verify=False)
    resp.raise_for_status()

    certs = resp.json().get('items', [])
    alertas = []

    for cert in certs:
        nome = cert.get('name', 'unknown')
        expiration = cert.get('apiRawValues', {}).get('expiration', '')

        if expiration:
            from datetime import datetime
            try:
                exp_date = datetime.strptime(expiration, "%b %d %H:%M:%S %Y %Z")
                dias_restantes = (exp_date - datetime.now()).days

                if dias_restantes <= dias_alerta:
                    alerta = {
                        'certificado': nome,
                        'expira_em': expiration,
                        'dias_restantes': dias_restantes,
                        'criticidade': 'CRITICO' if dias_restantes <= 7 else 'ALERTA'
                    }
                    alertas.append(alerta)
                    print(f"[{alerta['criticidade']}] {nome} expira em {dias_restantes} dias ({expiration})")
            except ValueError:
                print(f"[AVISO] Formato de data não reconhecido para {nome}: {expiration}")

    if not alertas:
        print("[OK] Todos os certificados estão dentro da validade.")

    return alertas
```

---

### 6. Problemas de GTM/DNS (Global Traffic Manager)

**Sintoma:** Resolução DNS retornando IPs incorretos ou falha de failover geográfico.

**Diagnóstico:**
```bash
# Verificar status dos wide IPs
tmsh show gtm wideip all

# Verificar status dos pools GTM
tmsh show gtm pool all

# Verificar status dos data centers
tmsh show gtm datacenter all

# Verificar iQuery (comunicação entre BIG-IPs)
tmsh show gtm server all

# Testar resolução DNS
dig @<f5_gtm_ip> app.empresa.com
```

---

## Caso Real: Monitoramento Acionando Automação para Recuperação do Ambiente

### Cenário

Uma empresa de e-commerce tem a seguinte arquitetura:
- **F5 BIG-IP** como load balancer principal
- **Pool com 6 servidores** de aplicação (3 em cada data center)
- **Aplicação crítica** de checkout que não pode ficar indisponível
- **Monitoramento** com Zabbix + Grafana

### O Problema (Caso Real)

Durante a Black Friday, 2 dos 3 servidores do data center primário caíram por estouro de memória, deixando apenas 1 servidor respondendo. O tempo de resposta subiu de 200ms para 8 segundos, causando timeout e perda de vendas.

**Impacto:** R$ 50.000/minuto em vendas perdidas até a equipe de NOC identificar e agir manualmente (levou 12 minutos).

### A Solução: Automação Inteligente

#### Arquitetura da Solução

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Zabbix     │────▶│   Webhook    │────▶│  Script Python  │
│  (Monitor)   │     │  (Trigger)   │     │  (Automação)    │
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                   │
                    ┌──────────────┐               │
                    │   Slack      │◀──────────────┤
                    │ (Notificação)│               │
                    └──────────────┘               │
                                                   ▼
                                          ┌─────────────────┐
                                          │   F5 BIG-IP     │
                                          │   (API REST)    │
                                          └─────────────────┘
```

#### Componente 1: Monitor Zabbix (Trigger)

```
# Template Zabbix - Item: F5 Pool Health
# Trigger: {F5:pool.available.members.last()}<2

# Ação configurada no Zabbix:
# Tipo: Remote Command
# Comando: /opt/scripts/f5_auto_recovery.py --pool pool_checkout --action auto_recover
```

#### Componente 2: Script de Recuperação Automática

```python
#!/usr/bin/env python3
"""
F5 Auto Recovery - Script de recuperação automática do ambiente.
Acionado por triggers do Zabbix quando problemas são detectados.

Autor: Equipe de Automação
Versão: 2.0
"""

import requests
import urllib3
import json
import time
import logging
import argparse
import subprocess
from datetime import datetime
from enum import Enum

urllib3.disable_warnings()

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('/var/log/f5_auto_recovery.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


class Severidade(Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class SlackNotifier:
    """Envia notificações para o Slack."""

    def __init__(self, webhook_url):
        self.webhook_url = webhook_url

    def enviar(self, mensagem, severidade=Severidade.INFO):
        cores = {
            Severidade.INFO: "#36a64f",
            Severidade.WARNING: "#ff9900",
            Severidade.CRITICAL: "#ff0000"
        }
        payload = {
            "attachments": [{
                "color": cores[severidade],
                "title": f"F5 Auto Recovery - {severidade.value.upper()}",
                "text": mensagem,
                "ts": int(time.time())
            }]
        }
        try:
            requests.post(self.webhook_url, json=payload, timeout=5)
        except Exception as e:
            logger.error(f"Falha ao enviar notificação Slack: {e}")


class F5AutoRecovery:
    """Classe principal de recuperação automática do F5."""

    def __init__(self, config):
        self.host = config['f5_host']
        self.username = config['f5_user']
        self.password = config['f5_pass']
        self.base_url = f"https://{self.host}/mgmt/tm"
        self.session = requests.Session()
        self.session.verify = False
        self.slack = SlackNotifier(config.get('slack_webhook', ''))
        self.max_tentativas = config.get('max_retries', 3)
        self._autenticar()

    def _autenticar(self):
        """Autentica no F5 via token."""
        url = f"https://{self.host}/mgmt/shared/authn/login"
        payload = {
            "username": self.username,
            "password": self.password,
            "loginProviderName": "tmos"
        }
        resp = requests.post(url, json=payload, verify=False)
        resp.raise_for_status()
        token = resp.json()['token']['token']
        self.session.headers.update({
            'Content-Type': 'application/json',
            'X-F5-Auth-Token': token
        })
        logger.info("Autenticação no F5 realizada com sucesso.")

    def obter_status_pool(self, pool_name):
        """Obtém status detalhado do pool e seus membros."""
        url = f"{self.base_url}/ltm/pool/~Common~{pool_name}/members/stats"
        resp = self.session.get(url)
        resp.raise_for_status()

        membros = []
        for key, value in resp.json().get('entries', {}).items():
            nested = value.get('nestedStats', {}).get('entries', {})
            membro = {
                'nome': nested.get('nodeName', {}).get('description', ''),
                'addr': nested.get('addr', {}).get('description', ''),
                'porta': nested.get('port', {}).get('value', 0),
                'status': nested.get('status.availabilityState', {}).get('description', ''),
                'enabled': nested.get('status.enabledState', {}).get('description', ''),
                'monitor': nested.get('monitorStatus', {}).get('description', ''),
                'conexoes': nested.get('serverside.curConns', {}).get('value', 0),
            }
            membros.append(membro)
        return membros

    def verificar_saude_backend(self, ip, porta, path="/health"):
        """Verifica diretamente se o backend está respondendo."""
        try:
            url = f"http://{ip}:{porta}{path}"
            resp = requests.get(url, timeout=5)
            return {
                'online': resp.status_code == 200,
                'status_code': resp.status_code,
                'tempo_resposta': resp.elapsed.total_seconds()
            }
        except requests.exceptions.RequestException as e:
            return {
                'online': False,
                'erro': str(e),
                'tempo_resposta': None
            }

    def reiniciar_servico_remoto(self, ip, servico="app-checkout"):
        """Reinicia o serviço no servidor backend via SSH."""
        try:
            cmd = [
                "ssh", "-o", "StrictHostKeyChecking=no",
                "-o", "ConnectTimeout=10",
                f"deployer@{ip}",
                f"sudo systemctl restart {servico}"
            ]
            resultado = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

            if resultado.returncode == 0:
                logger.info(f"Serviço '{servico}' reiniciado com sucesso em {ip}")
                return True
            else:
                logger.error(f"Falha ao reiniciar serviço em {ip}: {resultado.stderr}")
                return False
        except subprocess.TimeoutExpired:
            logger.error(f"Timeout ao conectar via SSH em {ip}")
            return False
        except Exception as e:
            logger.error(f"Erro ao reiniciar serviço em {ip}: {e}")
            return False

    def ativar_servidor_standby(self, pool_name, standby_members):
        """Ativa servidores em standby quando os primários falham."""
        ativados = []
        for membro in standby_members:
            nome = f"{membro['ip']}:{membro['porta']}"
            url = f"{self.base_url}/ltm/pool/~Common~{pool_name}/members/~Common~{nome}"
            payload = {
                "session": "user-enabled",
                "state": "user-up"
            }
            try:
                resp = self.session.put(url, json=payload)
                resp.raise_for_status()
                logger.info(f"Servidor standby ativado: {nome}")
                ativados.append(nome)
            except Exception as e:
                logger.error(f"Falha ao ativar standby {nome}: {e}")

        return ativados

    def ajustar_connection_limit(self, pool_name, membro, novo_limite):
        """Ajusta o limite de conexões de um membro do pool."""
        url = f"{self.base_url}/ltm/pool/~Common~{pool_name}/members/~Common~{membro}"
        payload = {"connectionLimit": novo_limite}
        resp = self.session.put(url, json=payload)
        resp.raise_for_status()
        logger.info(f"Connection limit de {membro} ajustado para {novo_limite}")

    def executar_recuperacao(self, pool_name, config_recuperacao):
        """
        Executa o fluxo completo de recuperação automática.

        Fluxo:
        1. Identifica membros com problema
        2. Tenta reiniciar serviço nos backends problemáticos
        3. Aguarda e verifica se voltaram
        4. Se não voltaram, ativa servidores standby
        5. Redistribui conexões nos membros saudáveis
        6. Notifica equipe via Slack
        7. Registra incidente
        """
        logger.info(f"{'='*60}")
        logger.info(f"INICIANDO RECUPERAÇÃO AUTOMÁTICA - Pool: {pool_name}")
        logger.info(f"{'='*60}")

        # PASSO 1: Identificar estado atual
        membros = self.obter_status_pool(pool_name)
        membros_down = [m for m in membros if m['status'] != 'available']
        membros_up = [m for m in membros if m['status'] == 'available']

        total = len(membros)
        down = len(membros_down)
        up = len(membros_up)

        logger.info(f"Status atual: {up}/{total} membros disponíveis")

        if not membros_down:
            logger.info("Todos os membros estão saudáveis. Nenhuma ação necessária.")
            return

        # Determinar severidade
        percentual_down = (down / total) * 100
        if percentual_down >= 80:
            severidade = Severidade.CRITICAL
        elif percentual_down >= 50:
            severidade = Severidade.WARNING
        else:
            severidade = Severidade.INFO

        self.slack.enviar(
            f"*Recuperação iniciada* para pool `{pool_name}`\n"
            f"Membros DOWN: {down}/{total} ({percentual_down:.0f}%)\n"
            f"Membros afetados: {', '.join([m['nome'] for m in membros_down])}",
            severidade
        )

        # PASSO 2: Tentar reiniciar serviços nos backends problemáticos
        logger.info("\n--- PASSO 2: Tentando reiniciar serviços nos backends ---")
        recuperados = []

        for membro in membros_down:
            ip = membro['addr']
            logger.info(f"Verificando backend {ip}...")

            # Primeiro verificar se o servidor está acessível
            saude = self.verificar_saude_backend(ip, membro['porta'])

            if not saude['online']:
                logger.info(f"Backend {ip} não responde. Tentando reiniciar serviço...")

                for tentativa in range(1, self.max_tentativas + 1):
                    logger.info(f"  Tentativa {tentativa}/{self.max_tentativas}...")
                    sucesso = self.reiniciar_servico_remoto(
                        ip,
                        config_recuperacao.get('servico', 'app-checkout')
                    )

                    if sucesso:
                        # Aguardar o serviço subir
                        logger.info(f"  Aguardando 15 segundos para o serviço inicializar...")
                        time.sleep(15)

                        # Verificar novamente
                        saude = self.verificar_saude_backend(ip, membro['porta'])
                        if saude['online']:
                            logger.info(f"  Backend {ip} recuperado! Tempo de resposta: {saude['tempo_resposta']:.3f}s")
                            recuperados.append(membro)
                            break
                        else:
                            logger.warning(f"  Backend {ip} ainda não responde após restart.")
                    else:
                        logger.warning(f"  Falha no restart do serviço em {ip}.")

                    if tentativa < self.max_tentativas:
                        time.sleep(10)
            else:
                logger.info(f"Backend {ip} responde mas F5 marca como down. Possível problema no monitor.")
                # O monitor do F5 pode estar com configuração diferente do health check direto

        # PASSO 3: Verificar resultado após tentativas de recuperação
        logger.info("\n--- PASSO 3: Verificando resultado ---")
        time.sleep(10)  # Aguardar F5 atualizar status dos monitors
        membros_atualizado = self.obter_status_pool(pool_name)
        membros_ainda_down = [m for m in membros_atualizado if m['status'] != 'available']

        if not membros_ainda_down:
            logger.info("TODOS os membros recuperados com sucesso!")
            self.slack.enviar(
                f"*Recuperação COMPLETA* para pool `{pool_name}`\n"
                f"Todos os {total} membros estão disponíveis novamente.",
                Severidade.INFO
            )
            return

        # PASSO 4: Ativar servidores standby se necessário
        if membros_ainda_down and config_recuperacao.get('standby_members'):
            logger.info("\n--- PASSO 4: Ativando servidores standby ---")
            standby = config_recuperacao['standby_members']
            ativados = self.ativar_servidor_standby(pool_name, standby)

            if ativados:
                self.slack.enviar(
                    f"*Servidores standby ativados* no pool `{pool_name}`\n"
                    f"Servidores: {', '.join(ativados)}",
                    Severidade.WARNING
                )

        # PASSO 5: Redistribuir carga nos membros saudáveis
        logger.info("\n--- PASSO 5: Redistribuindo carga ---")
        membros_saudaveis = [m for m in membros_atualizado if m['status'] == 'available']

        if membros_saudaveis:
            # Aumentar connection limit temporariamente nos membros saudáveis
            novo_limite = config_recuperacao.get('emergency_conn_limit', 5000)
            for membro in membros_saudaveis:
                nome_membro = f"{membro['addr']}:{membro['porta']}"
                try:
                    self.ajustar_connection_limit(pool_name, nome_membro, novo_limite)
                except Exception as e:
                    logger.error(f"Erro ao ajustar connection limit de {nome_membro}: {e}")

        # PASSO 6: Relatório final
        logger.info("\n--- RELATÓRIO FINAL ---")
        membros_final = self.obter_status_pool(pool_name)
        membros_up_final = [m for m in membros_final if m['status'] == 'available']
        membros_down_final = [m for m in membros_final if m['status'] != 'available']

        relatorio = (
            f"*Relatório de Recuperação - Pool `{pool_name}`*\n\n"
            f"Horário: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
            f"Membros recuperados: {len(recuperados)}\n"
            f"Membros disponíveis: {len(membros_up_final)}/{len(membros_final)}\n"
            f"Membros ainda indisponíveis: {len(membros_down_final)}\n"
        )

        if membros_down_final:
            relatorio += f"\nMembros que precisam de atenção manual:\n"
            for m in membros_down_final:
                relatorio += f"  - {m['nome']} ({m['addr']}): {m['monitor']}\n"
            relatorio += "\n*Ação requerida: Equipe de infraestrutura deve investigar manualmente.*"

            self.slack.enviar(relatorio, Severidade.CRITICAL)
            logger.warning("RECUPERAÇÃO PARCIAL - Intervenção manual necessária.")
        else:
            self.slack.enviar(relatorio, Severidade.INFO)
            logger.info("RECUPERAÇÃO COMPLETA!")

        logger.info(f"{'='*60}")


def main():
    parser = argparse.ArgumentParser(description='F5 Auto Recovery')
    parser.add_argument('--pool', required=True, help='Nome do pool a recuperar')
    parser.add_argument('--action', default='auto_recover', choices=['auto_recover', 'status', 'activate_standby'])
    parser.add_argument('--config', default='/etc/f5_recovery/config.json', help='Arquivo de configuração')
    args = parser.parse_args()

    # Carregar configuração
    # Em produção, use arquivo de configuração seguro
    config = {
        'f5_host': '192.168.1.245',
        'f5_user': 'admin',
        'f5_pass': 'SenhaSegura123',  # Em produção: variável de ambiente ou vault
        'slack_webhook': 'https://hooks.slack.com/services/XXXX/YYYY/ZZZZ',
        'max_retries': 3
    }

    config_recuperacao = {
        'servico': 'app-checkout',
        'emergency_conn_limit': 5000,
        'standby_members': [
            {'ip': '10.10.2.10', 'porta': 80},
            {'ip': '10.10.2.11', 'porta': 80},
            {'ip': '10.10.2.12', 'porta': 80},
        ]
    }

    recovery = F5AutoRecovery(config)

    if args.action == 'status':
        membros = recovery.obter_status_pool(args.pool)
        for m in membros:
            status_icon = "[OK]" if m['status'] == 'available' else "[DOWN]"
            print(f"  {status_icon} {m['nome']} | Status: {m['status']} | Conns: {m['conexoes']}")

    elif args.action == 'auto_recover':
        recovery.executar_recuperacao(args.pool, config_recuperacao)

    elif args.action == 'activate_standby':
        recovery.ativar_servidor_standby(args.pool, config_recuperacao['standby_members'])


if __name__ == "__main__":
    main()
```

#### Componente 3: Playbook Ansible para Recuperação (Alternativa)

```yaml
# playbook_recovery.yml
---
- name: F5 Auto Recovery via Ansible
  hosts: f5_devices
  connection: local
  gather_facts: false

  vars:
    provider:
      server: "192.168.1.245"
      user: "admin"
      password: "{{ vault_f5_password }}"
      validate_certs: false
    pool_name: "pool_checkout"
    standby_members:
      - host: "10.10.2.10"
        port: 80
      - host: "10.10.2.11"
        port: 80

  tasks:
    - name: Obter status do pool
      f5networks.f5_modules.bigip_pool:
        provider: "{{ provider }}"
        name: "{{ pool_name }}"
      register: pool_status

    - name: Verificar membros com problema
      f5networks.f5_modules.bigip_pool_member:
        provider: "{{ provider }}"
        pool: "{{ pool_name }}"
      register: members_status

    - name: Notificar Slack sobre início da recuperação
      uri:
        url: "{{ slack_webhook }}"
        method: POST
        body_format: json
        body:
          text: "Iniciando recuperação automática do pool {{ pool_name }}"

    - name: Reiniciar serviço nos backends problemáticos
      delegate_to: "{{ item }}"
      ansible.builtin.systemd:
        name: app-checkout
        state: restarted
      loop: "{{ backends_down }}"
      ignore_errors: true

    - name: Aguardar serviços reiniciarem
      pause:
        seconds: 20

    - name: Ativar servidores standby se necessário
      f5networks.f5_modules.bigip_pool_member:
        provider: "{{ provider }}"
        pool: "{{ pool_name }}"
        host: "{{ item.host }}"
        port: "{{ item.port }}"
        state: present
      loop: "{{ standby_members }}"
      when: membros_disponiveis < 2

    - name: Notificar conclusão
      uri:
        url: "{{ slack_webhook }}"
        method: POST
        body_format: json
        body:
          text: "Recuperação concluída para pool {{ pool_name }}"
```

### Resultado da Implementação

| Métrica | Antes (Manual) | Depois (Automação) |
|---------|---------------|-------------------|
| Tempo de detecção | 5-10 min | 30 segundos |
| Tempo de recuperação | 12-25 min | 2-3 min |
| Perda financeira (Black Friday) | R$ 600.000+ | R$ 25.000 |
| Intervenção humana | Sempre necessária | Somente em casos críticos |
| Disponibilidade | 99.5% | 99.95% |
| MTTR (Mean Time To Recovery) | 18 min | 2.5 min |

---

## Conclusão e Recomendações

### Para equipes iniciando com automação F5:

1. **Comece com Ansible** — mais fácil de aprender e implementar
2. **Evolua para Python** — quando precisar de lógica complexa e monitoramento
3. **Use os dois juntos** — Ansible para provisionamento, Python para monitoramento e recuperação

### Arquitetura recomendada:

```
┌────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Ansible Tower  │     │   Python Scripts  │     │   F5 BIG-IP     │
│  (Provisionar)  │────▶│   (Monitorar +    │────▶│   (API REST)    │
│                 │     │    Recuperar)      │     │                 │
└────────────────┘     └──────────────────┘     └─────────────────┘
        │                       │
        ▼                       ▼
┌────────────────┐     ┌──────────────────┐
│   Git (IaC)    │     │  Zabbix/Grafana  │
│                │     │  (Dashboards)     │
└────────────────┘     └──────────────────┘
```

### Próximos passos sugeridos:

1. Configurar lab com F5 VE (Virtual Edition) para prática
2. Implementar os scripts de monitoramento em ambiente de homologação
3. Integrar com ferramenta de ITSM (ServiceNow) para abertura automática de chamados
4. Criar dashboards no Grafana com métricas coletadas via Python
5. Implementar testes automatizados para validar as automações

---

*Documento criado para fins educacionais. Adapte os exemplos para seu ambiente específico.*
