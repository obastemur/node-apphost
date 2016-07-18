var taskman = require('./tools/taskman');
var fs = require('fs');
var path = require('path');
var isWindows = process.platform === 'win32';
var args = taskman.args;

function print_help(exit_code) {
  var params = [
    {option: "--help", text: "display available options"},
    {option: "", text: ""}, // placeholder
    {option: "--cid_node=[commit-id]", text: "Checkout a particular commit from node/node-chakracore repo"},
    {option: "--cid_jxcore=[commit-id]", text: "Checkout a particular commit from jxcore repo"},
    {option: "--dest-cpu=[cpu_type]", text: "set target cpu (arm, ia32, x86, x64). i.e. --dest-cpu=ia32"},
    {option: "--ndk-path=[path]", text: "path to android ndk. This option is required for platform=android"},
    {option: "--platform=[target]", text: "set target platform. by default 'desktop'. (android, desktop, ios, windows-arm)"},
    {option: "--force-target=[jxcore or nodejs]", text: "Force target framework regardless from the platform"},
    {option: "--release", text: "Build release binary. By default Debug"},
    {option: "--reset", text: "Clone nodejs and jxcore repos once again"},
    {option: "--test", text: "run tests after build"}
  ];
  for(var i in params) {
    var param = params[i];
    var space = new Buffer(28 - param.option.length); space.fill(" ");
    console.log(param.option, space + ": ", param.text);
  }
  process.exit(exit_code);
}

if (args.hasOwnProperty('--help')) {
  print_help(0);
} else {
  console.log('tip: try "--help" for other options');
}

var platform = args.hasOwnProperty('--platform') ? args['--platform'] : 'desktop';
var forced_target = args['--force-target'];
var release = args.hasOwnProperty('--release');

function createScript() {
  var cpu = "";
  if (!isWindows) {
    if (args.hasOwnProperty('--dest-cpu')) {
      cpu = "--dest-cpu=" + args['--dest-cpu'];
    }

    if (platform == "ios" || platform == "android" || forced_target == 'jxcore') {
      var script = 'cd jxcore\n';
      if (platform == "android") {
        if (!args.hasOwnProperty('--ndk-path')) {
          console.error('forget "--ndk-path" ??\n');
          print_help(1);
        }

        forced_target = 'jxcore';
        script += "build_scripts/android-configure.sh " + args["--ndk-path"] + "\n"
              + "if [ $? != 0 ]; then\n"
              + "  exit 1\n"
              + "fi\n"
              + "build_scripts/android_compile.sh " + args["--ndk-path"] + "\n"
              + "if [ $? != 0 ]; then\n"
              + "  exit 1\n"
              + "fi\n";
        return script;
      } else if (platform == "ios") { // ios
        forced_target = 'jxcore';
        script += "build_scripts/ios_compile.sh\n"
                + "if [ $? != 0 ]; then\n"
                + "  exit 1\n"
                + "fi\n";
        return script;
      } else {
        forced_target = 'jxcore';
        return "cd jxcore\n./configure --engine-mozilla --static-library "
                + (release ? ' ' : '--debug ') + cpu
                + '\nmake';
      }
    } else {
      forced_target = 'nodejs';
      return 'cd nodejs;./configure --enable-static '
            + (release ? ' ' : '--debug ') + cpu
            + ';make -j ' + require('os').cpus().length;
    }
  } else {
    if (platform == "windows-arm") {
      cpu = "arm";
    } else if (args.hasOwnProperty('--dest-cpu')){
      cpu = args['--dest-cpu'];
    }

    if (platform == "windows-arm" && forced_target == 'jxcore') {
      console.error("For Windows ARM, node-chakracore is the only supported option.");
      exit(1);
    }

    var batch = "";
    if (forced_target == 'jxcore')
      batch += 'cd jxcore\nvcbuild.bat ia32 --shared-library '
             + (release ? 'release ' : 'debug ') + cpu + '\n';
    else {
      forced_target = 'nodejs';
      batch += 'cd nodejs\nvcbuild.bat chakracore nosign '
             + (release ? 'release ' : 'debug ') + cpu + '\n';
    }

    return batch;
  }
}

var stash = function(repo) {
  return path.join(__dirname, "temp/stash.bat") + " " + repo;
};

var compile = function(repo) {
  return path.join(__dirname, "temp/compile.bat") + " " + repo;
};

var createBatch = function() {
  try {
    fs.mkdirSync('./temp');
  } catch(e) { }

  // this needs to be called first
  fs.writeFileSync('./temp/compile.bat', createScript());

  if (isWindows) {
    fs.writeFileSync('./temp/stash.bat', 'cd %1\ngit stash\ngit stash clear');
    fs.writeFileSync('./temp/copy.bat',  ('del winproj\\test_app\\*.lib \n'
                                       + 'del winproj\\test_app\\*.dll \n'
                                       + 'del winproj\\test_app\\*.exe \n'
                                       + 'copy $$TARGET\\$$MODE\\*.lib winproj\\test_app\\ \n'
                                       + 'copy $$TARGET\\$$MODE\\*.dll winproj\\test_app\\ \n'
                                       + 'copy $$TARGET\\$$MODE\\*.exe winproj\\test_app\\ \n')
                                       .replace(/\$\$MODE/g, release ? "Release" : "Debug")
                                       .replace(/\$\$TARGET/g, forced_target));
  } else {
    fs.writeFileSync('./temp/stash.bat', 'cd $1;git stash;git stash clear');
  }

  var br_node = args.hasOwnProperty('--cid_node') ? args['--cid_node'] : "master";
  var br_jxcore = args.hasOwnProperty('--cid_jxcore') ? args['--cid_jxcore'] : "master";
  fs.writeFileSync('./temp/checkout_node.bat', taskman.checkout('nodejs', br_node));
  fs.writeFileSync('./temp/checkout_jxcore.bat', taskman.checkout('jxcore', br_jxcore));

  if (!isWindows) {
    fs.chmodSync('./temp/stash.bat', '0755');
    fs.chmodSync('./temp/compile.bat', '0755');
    fs.chmodSync('./temp/checkout_node.bat', '0755');
    fs.chmodSync('./temp/checkout_jxcore.bat', '0755');
  }
}

var setup = function() {
  taskman.tasker = [
    [taskman.rmdir('nodejs'), "deleting nodejs folder"],
    [taskman.rmdir('jxcore'), "deleting jxcore folder"],
    [taskman.clone(isWindows ? 'nodejs/node-chakracore' : 'nodejs/node', 'nodejs'),
                                "cloning nodejs"],
    [taskman.clone('jxcore/jxcore', 'jxcore'), "cloning jxcore"],
    ['./temp/checkout_node.bat', "checkout nodejs branch"],
    ['./temp/checkout_jxcore.bat', "checkout jxcore branch"]
  ];
};

if (args.hasOwnProperty('--reset') || !fs.existsSync(path.resolve('nodejs'))) {
  console.log("Setting Up! [ This will take some time.. ]");
  setup();
} else {
  taskman.tasker = [
    [stash('nodejs'), "resetting nodejs source codes"],
    [stash('jxcore'), "resetting jxcore source codes"]
  ];
}

var patch_nodejs = function() {
  console.log("[ patching node.gyp ]")
  var node_gyp = fs.readFileSync('./nodejs/node.gyp') + "";
  node_gyp = node_gyp.replace("'sources': [\n",
    "'sources': [\n'../patch/node/node_vfile.cc',\n'../patch/node/node_wrapper.cc',\n");
  fs.writeFileSync('./nodejs/node.gyp', node_gyp);

  console.log("nodejs -> [ patching node.cc ]");
  {
    var nodejs_cc = fs.readFileSync('./nodejs/src/node.cc') + "";

    for(var n = nodejs_cc.length-1;n > 0; n--) {
      var ch = nodejs_cc[n];
      if (ch == '}') { // find namespace closing
        var left = nodejs_cc.substr(0, n);
        var right = nodejs_cc.substr(n);
        fs.writeFileSync('./nodejs/src/node.cc', left
              + '\n#include "../../patch/node/node_internal_wrapper.cc"\n' + right);
        break;
      }
    }
  }

  console.log("nodejs -> [ patching module.js ]");
  {
    var module_patch = fs.readFileSync('patch/node/module_patch.js') + "";
    var module_js = fs.readFileSync('./nodejs/lib/module.js') + "";
    fs.writeFileSync('./nodejs/lib/module.js', module_js + "\n" + module_patch);
  }

  console.log("nodejs -> [ patching fs.js ]");
  {
    var fs_patch = fs.readFileSync('patch/node/fs_patch.js') + "";
    var fs_js = fs.readFileSync('./nodejs/lib/fs.js') + "";
    fs.writeFileSync('./nodejs/lib/fs.js', fs_js + "\n" + fs_patch);
  }
};

var patch_jxcore = function() {
  console.log("[ patching jx.gyp ]")
  var node_gyp = fs.readFileSync('./jxcore/jx.gyp') + "";
  node_gyp = node_gyp.replace("'sources': [\n", "'sources': [\n'../patch/jxcore/jxcore_wrapper.cc',\n");
  fs.writeFileSync('./jxcore/jx.gyp', node_gyp);
};

var finalize = function() {
  console.log('done.');
};

taskman.tasker.push(
  [patch_nodejs],
  [patch_jxcore],
  [compile(forced_target), "building for " + platform],
  [isWindows ? "temp\\copy.bat" : null, "copying Windows binaries"],
  [finalize]
);

createBatch();
taskman.runTasks();
