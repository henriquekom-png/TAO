# TAO App - Guia Completo para Iniciantes

Bem-vindo ao TAO App! Este documento foi criado especialmente para você que está começando e precisa de um passo a passo detalhado para rodar a aplicação no seu computador. Não se preocupe se alguns termos parecerem estranhos, explicaremos tudo de forma simples e minuciosa!

## 📌 O que é este projeto?
O TAO App é uma aplicação completa voltada para o aprendizado e gestão de conhecimento. Ele permite organizar documentos em pastas, estudar questões, e utiliza Inteligência Artificial (Google Gemini) e repetição espaçada (FSRS) para ajudar nos seus estudos.

## 🏗️ Como o projeto é dividido?
O projeto é dividido em três partes principais:
1. **Frontend (A "Cara" do App)**: É a interface visual onde você clica e interage. Fica na pasta `frontend`.
2. **Backend (O "Cérebro" do App)**: É a parte invisível que processa os dados, conecta com a inteligência artificial e salva tudo. Fica na pasta `backend`.
3. **Banco de Dados (A "Memória" do App)**: Onde todas as informações (documentos, pastas, questões) ficam salvas. Usamos um serviço online chamado **Supabase**.

---

## 🛠️ 1. O que você precisa instalar (Pré-requisitos)
Antes de começarmos, certifique-se de que você tem os seguintes programas instalados no seu computador. Se não tiver, clique nos links para baixar e instalar (pode usar as opções "Next/Avançar" padrão).

- **Git**: Para versionar e baixar o código. [Baixar Git](https://git-scm.com/downloads)
- **Node.js**: Necessário para rodar o Frontend. (Baixe a versão "LTS"). [Baixar Node.js](https://nodejs.org/)
- **Python**: Necessário para rodar o Backend. (⚠️ **MUITO IMPORTANTE**: Durante a instalação, logo na primeira tela, marque a caixinha **"Add Python to PATH"** ou "Adicionar Python ao PATH" no rodapé). [Baixar Python](https://www.python.org/downloads/)
- **VS Code (Visual Studio Code) ou Cursor**: Um editor de código moderno para abrir o projeto. [Baixar VS Code](https://code.visualstudio.com/)

---

## 🚀 2. Preparando o Banco de Dados na Nuvem (Supabase)
Como nosso banco de dados fica na nuvem, você precisa criar um projeto lá:

1. Acesse o [Supabase](https://supabase.com/) e crie uma conta (ou faça login).
2. Clique no botão verde **"New Project"** (Novo Projeto).
3. Dê um nome ao projeto e crie uma **Database Password** (senha do banco). **Anote essa senha**, você vai precisar dela! Aguarde o projeto ser criado (pode levar alguns minutos).
4. No menu lateral esquerdo do Supabase, clique em **"SQL Editor"** (ícone de um terminal/código).
5. Clique no botão **"New Query"** (Nova Consulta).
6. No seu computador, abra o arquivo chamado `supabase_schema.sql` (que está na pasta principal do projeto TAO_FULL).
7. Copie **todo o texto** de dentro do `supabase_schema.sql`, cole na área em branco do "SQL Editor" do Supabase e clique no botão verde **"Run"** (Rodar) no canto inferior direito.
   - *Isso vai criar as tabelas necessárias (pastas, documentos, questões) no seu banco.*
8. Agora precisamos pegar a "chave" para o seu app conversar com esse banco. No Supabase, vá em **Project Settings** (ícone de engrenagem no menu lateral inferior) -> **Database**.
9. Desça a página até achar a seção **"Connection string"**. Selecione a aba **"URI"**. 
10. Copie o texto que aparece lá. Vai ser algo parecido com: 
    `postgresql://postgres.[sua-referencia]:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`

---

## ⚙️ 3. Configurando o Projeto no seu Computador

Abra o seu editor de código (VS Code ou Cursor). Clique em "File" -> "Open Folder" e abra a pasta principal do projeto (provavelmente chamada `TAO_FULL`).

### Passo 3.1: Arquivos Secretos (O arquivo `.env`)
O projeto precisa saber as senhas do banco de dados e da Inteligência Artificial. Para não expor essas senhas, criamos um arquivo chamado `.env`.

**Na pasta principal (TAO_FULL):**
1. Procure o arquivo chamado `.env.example`.
2. Clique com o botão direito nele, copie e cole na mesma pasta, e renomeie essa cópia para **apenas `.env`** (com o ponto no início, sem a palavra "example").
3. Abra esse novo arquivo `.env`.
4. Lembra do texto que você copiou do Supabase no passo 9? 
   - Substitua a parte `[YOUR-PASSWORD]` pela senha que você criou lá no passo 3.
   - Cole esse texto completo na frente de `SUPABASE_DB_URL=` e também na frente de `DATABASE_URL=`.
5. Em `GEMINI_API_KEY=...`, coloque a sua chave da API do Google Gemini. Se não tiver uma, crie de graça no [Google AI Studio](https://aistudio.google.com/).
6. Salve o arquivo (Ctrl + S).

**Na pasta `frontend`:**
1. Abra a pasta `frontend`.
2. Procure o arquivo `.env.example` dentro dela.
3. Copie, cole e renomeie para **`.env`**.
4. Verifique se ele tem a linha `VITE_API_URL=http://localhost:8000/api/v1`. Pode deixar exatamente assim. Salve o arquivo.

---

## 💻 4. Ligando o Backend (O Cérebro em Python)

No seu editor de código, abra o **Terminal** (Menu Superior -> Terminal -> New Terminal).

1. Digite o comando abaixo e aperte Enter para entrar na pasta do backend:
   ```bash
   cd backend
   ```
2. Crie um "Ambiente Virtual" (isso cria uma bolha protetora para não bagunçar o Python do seu PC):
   ```bash
   python -m venv .venv
   ```
3. Ative essa bolha protetora:
   - Se estiver usando o **PowerShell** (padrão do Windows no VS Code):
     ```bash
     .\.venv\Scripts\Activate.ps1
     ```
   - Se estiver usando o **Command Prompt (CMD)**:
     ```bash
     .venv\Scripts\activate
     ```
   - *(Dica: Se deu certo, vai aparecer um `(.venv)` verde no início da linha do terminal).*
4. Instale as ferramentas que o backend precisa:
   ```bash
   pip install -r requirements.txt
   ```
   *(Aguarde o download e instalação terminar).*
5. **Inicie o servidor**:
   Para iniciar, o jeito mais fácil é rodar este comando:
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```
   - O terminal vai mostrar mensagens informando que o servidor iniciou e está rodando em `http://127.0.0.1:8000`. 
   - **IMPORTANTE:** Deixe este terminal **aberto** e rodando! Não o feche.

---

## 🎨 5. Ligando o Frontend (A Tela do App)

Agora vamos ligar a interface visual.
No seu editor, abra um **NOVO Terminal** (deixe o terminal do backend rodando quietinho onde ele está, apenas abra uma aba nova).

1. Digite o comando para entrar na pasta do frontend:
   ```bash
   cd frontend
   ```
2. Instale os pacotes visuais do projeto:
   ```bash
   npm install
   ```
   *(Aguarde, pode demorar cerca de um minuto e criar uma pasta `node_modules`).*
3. **Inicie o Frontend**:
   ```bash
   npm run dev
   ```
4. O terminal vai terminar de carregar e mostrará um endereço na cor azul, geralmente `http://localhost:5173/`. 
5. Segure a tecla `Ctrl` e clique nesse link com o mouse (ou copie e cole no seu navegador Google Chrome, Edge, etc.).

🎉 **Parabéns! O seu TAO App já está funcionando na tela do seu navegador!**

---

## 📚 Bônus: Como adicionar questões prontas ao sistema?
Se você tiver um arquivo de questões no formato `.json` e quiser colocá-las no banco de dados automaticamente, temos um "script" (robozinho) para isso.

1. Abra um terminal novo na pasta **raiz** do projeto (a pasta principal `TAO_FULL`).
2. Digite o comando abaixo, substituindo `seu_arquivo.json` pelo caminho real do seu arquivo:
   ```bash
   python seed_questoes.py seu_arquivo.json
   ```
*(Nota: Para isso funcionar, o seu Python já deve reconhecer o pacote `python-dotenv` e o arquivo principal `.env` da raiz deve estar configurado corretamente com a URL do Supabase).*

---

## 🆘 Solução de Problemas Comuns (Erros)

- **Erro: "O termo 'python' (ou 'npm') não é reconhecido como nome de cmdlet..."**
  Isso significa que você não instalou o Node.js ou o Python corretamente, ou esqueceu de marcar a caixinha "Add to PATH" durante a instalação do Python. Feche o VS Code, reinstale os programas marcando a caixinha e abra o VS Code novamente.
  
- **Erro ao conectar no Supabase / Backend não inicia corretamente:**
  Verifique se você copiou a "Connection string" direitinho no `.env` da raiz, e se apagou os colchetes `[]` da senha. Por exemplo, se a sua senha é `Abc123`, a URL deve ficar `...postgres:Abc123@aws...`, e NÃO `...postgres:[Abc123]@aws...`.

- **Erro vermelho ao tentar rodar `.\.venv\Scripts\Activate.ps1` (Restrição de Scripts do Windows):**
  Se o Windows bloquear a ativação do ambiente virtual com uma mensagem de segurança vermelha:
  1. Abra o Menu Iniciar do Windows, procure por "PowerShell", clique com o botão direito e escolha **"Executar como Administrador"**.
  2. Digite este comando e aperte Enter: `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`
  3. Responda `S` (Sim) se perguntar.
  4. Feche a janela azul, volte ao VS Code e tente rodar o comando de ativar de novo.
