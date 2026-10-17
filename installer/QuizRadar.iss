; QuizRadar — Inno Setup Installer Script
; Builds QuizRadar-Setup-v2.2.0-x64.exe with custom QuizRadar icon & wizard branding

#ifndef MyAppVersion
  #define MyAppVersion "2.2.0"
#endif

#define MyAppName "QuizRadar"
#define MyAppPublisher "TheDragonSoft"
#define MyAppURL "https://github.com/TheDragonSoft/QuizRadar"
#define MyAppExeName "quizradar.exe"

[Setup]
AppId={{8F9E4A21-7C3B-4E5D-9A1B-6D2C8E4F1020}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} v{#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\dist
OutputBaseFilename=QuizRadar-Setup-v{#MyAppVersion}-x64
SetupIconFile=..\assets\icon.ico
WizardImageFile=..\assets\wizard-SideImage.bmp
WizardSmallImageFile=..\assets\wizard-SmallImage.bmp
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Dirs]
Name: "{app}\data"
Name: "{app}\static"
Name: "{app}\assets"

[Files]
Source: "..\target\release\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\static\*"; DestDir: "{app}\static"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\assets\icon.ico"; DestDir: "{app}\assets"; Flags: ignoreversion
Source: "..\assets\icon.png"; DestDir: "{app}\assets"; Flags: ignoreversion
Source: "..\data\schedule.json"; DestDir: "{app}\data"; Flags: onlyifdoesntexist
Source: "..\credentials.json"; DestDir: "{app}"; Flags: skipifsourcedoesntexist
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\assets\icon.ico"; Comment: "QuizRadar — Smart Academic Dashboard & Exam Calendar"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\assets\icon.ico"; Comment: "QuizRadar — Smart Academic Dashboard & Exam Calendar"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
