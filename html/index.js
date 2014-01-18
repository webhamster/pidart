

function fitText() {
    var divisors = [4, 6, 12, 18];
    //if ($(window).height() < $(window).width()) {
	for (var d in divisors) {
	    $( '.fit-height-body-' + divisors[d] ).each(function ( i, box ) {
		$(box).css('font-size', $(window).height()/divisors[d]);
	    });
	}
    //} else {
	for (var d in divisors) {
	    $( '.fit-width-body-' + divisors[d] ).each(function ( i, box ) {
		$(box).css('font-size', $(window).height()/divisors[d]);
	    });
	}
    //}
}

var eloEngine = new function(){
    var EloK = 16;
    var EloInitR = 1500;
    var LOSS = 0;
    var WON = 1;
    var DRAW = 0.5;

    function elo_exp (ra, rb) {
	return 1.0 / (1 + Math.pow(10, (rb-ra)/400.0));
    }

    function transform (ranking) {
	var game = {};
	$.each(ranking, function(index, info) {
	    var player = info['name'];
	    var against = {};
	    $.each(ranking, function(index2, info2) {
		var opponent = info2['name'];
		if (player === opponent) {
		    return;
		}
		if (info['rank'] == info2['rank']) {
		    against[opponent] = DRAW;
		} else if (info['rank'] < info2['rank']) {
		    against[opponent] = WON;
		} else {
		    against[opponent] = LOSS;
		}
		console.debug("ELO: " + info['name'] + " vs. " + info2['name'] + ": " + against[opponent]);
	    });
	    game[player] = against;
	});
	console.debug(game);
	return game;
    }

    function compute_ratings(old_ratings, game) {
	var new_ratings = $.extend(true, {}, old_ratings);
	$.each(game, function(playerA, results) {
	    var ra = (typeof(old_ratings[playerA]) === 'undefined')
		? EloInitR
		: old_ratings[playerA];
	    var sum = 0;
	    var exp_sum = 0;
	    $.each(results, function (playerB, result) {
		sum += result;
		var rb = (typeof(old_ratings[playerB]) === 'undefined') ? EloInitR : old_ratings[playerB];
		exp_sum += elo_exp(ra, rb);
	    });
	    var new_ra = ra + EloK * (sum - exp_sum);
	    console.debug("ELO for player " + playerA + " was " + new_ratings[playerA] + " -> " + new_ra);
	    new_ratings[playerA] = new_ra;
	});
	return new_ratings;
    }

    this.calc = function(old_ratings, ranking) {
	return compute_ratings(old_ratings, transform(ranking));
    }

};

function postxhr(data, onsuccess) {
    $.post('xhr', JSON.stringify(data))
    .done(function(data) {
	d = JSON.parse(data);
	if (! d.success) {
	    alert('Unable to execute command: ' + data);
	}
	if (onsuccess) {
	    onsuccess(d);
	}
    })
    .fail(function(xhr, text, error) {
	alert('Unable to execute command: ' + text + ' - ' + error);
    });
}

function get(a, b) {
    if (typeof(a) === 'undefined') {
	return b;
    }
    return a;
}
        

$(window).resize(function() {
    fitText()
});

$(document).ready(function() {
    fitText()
});

angular.module('darts', ['googlechart', 'ngDragDrop']).controller('DartCtrl', function ($scope, $timeout, $filter) {
    $scope.state = {};
    $scope.availablePlayers = [];
    $scope.selectedPlayers = [];
    $scope.latestScores = {};
    $scope.usualSuspects = ['DF', 'ES', 'GS', 'OC', 'RK', 'TT'];
    $scope.playersInChart = [];
    $scope.initialValue = 301;
    $scope.predicate = 'p.started';
    $scope.chartUpdating = true; // chart is being updated (show loader)
    $scope.oldChartData = false; // We use this to only update the chart when something has actually changed.
    $scope.debugging = false;
    $scope.debugDartValue = 'T20';
    $scope.firstChartUpdateTriggered = false;

    var history = {};
    history.type="LineChart";
    history.data = {};
    history.options = {
        "isStacked": "false",
        "fill": 20,
        "displayExactValues": false,
        "vAxis": {
            "title": "ELO points", "gridlines": {"count": 5}
        },
        "hAxis": {
            "title": "Date"
        },
	containerId: "mychart"
    };

    $scope.chart = history;

    var wsuri = window.location.href.replace(/^http(s?:\/\/.*):\d+\/.*$/, 'ws$1:8080/websocket');
    $scope.sock = new ReconnectingWebSocket(wsuri);

    $(document).ready(function() {
	$('a[data-toggle="tab"]').on('shown.bs.tab', function (e) {
	    if (e.target.hash == '#stats') {
		$scope.$emit('resizeMsg');
	    }
	});
	$scope.updateChartFull();
	window.setInterval($scope.updateChartFull, 1000 * 60 * 5);

    });

    $scope.sock.onopen = function() {
	console.log("Connected to " + wsuri);
	$scope.sock.send("hello");
    }

    $scope.sock.onclose = function(e) {
	console.log("Connection closed (wasClean = " + e.wasClean + ", code = " + e.code + ", reason = '" + e.reason + "')");
	$scope.state.state = 'connlost';
	$scope.$apply();
	fitText();
    }

    $scope.sock.onmessage = function(e) {
	console.log("Got message: " + e.data);
	var message = JSON.parse(e.data);
	if (message.type == 'state') {
	    $scope.state = $.extend($scope.state, message.state);
	    
	    if (typeof(message.state.ranking) !== 'undefined') {
		$scope.updateChartRanking(true);
	    }
	    
	    $scope.$apply();
	    fitText();
	    if (! $scope.firstChartUpdateTriggered) {
		$scope.updateChartFull();
	    }
	}
	else if (message.type == 'info') {
	    if (message.info == 'game_initialized') {
		$scope.updateChartFull();
		$('a[href="#order"]').trigger('click');
	    }
	}
    }

    $scope.skipPlayer = function(player) {
	postxhr({
	    command: 'skip-player',
	    player: player
	});
    }

    $scope.newGame = function() {
	if ($scope.selectedPlayers.length < 2) {
	    alert("Please select at least two players.");
	    return;
	}
	if ($scope.state.state != 'gameover' && $scope.state.state != 'null') {
	    if (! confirm("Do you want to cancel the current game?")) {
		return;
	    }
	}
	var players = [];
	for (var i = 0; i < $scope.selectedPlayers.length; i ++) {
	    players.push($scope.selectedPlayers[i].name);
	}
	if (! confirm("Is this order correct?\n" + players.join(', '))) {
	    return;
	}
	postxhr({
	    command: 'new-game',
	    players: players,
	    startvalue: $scope.initialValue,
	    testgame: false
	});
    };

    $scope.updateChartFull = function() {
	if (! $scope.state.players) {
	    return;
	}
	$scope.firstChartUpdateTriggered = true;
	$scope.chartUpdating = true;
	$.ajax('http://infsec.uni-trier.de/dartenbank/rpc/elo.php?count=30', {
	    dataType: 'JSON'
	})
	    .done(function(data) {
		if ($scope.oldChartData === data) {
		    return;
		}
		$scope.oldChartData = data;
		$scope.playersInChart = $.merge([], $scope.usualSuspects);
		console.debug("-B");
		$.each($scope.state.players, function (i, name) {
		    if ($scope.playersInChart.indexOf(name) === -1) {
			$scope.playersInChart.push(name);
		    }
		});
		console.log("Updating chart.");
		$scope.chart.data.cols = [];
		$scope.chart.data.rows = [];
		$scope.chart.data.cols.push({
		    id: 'date',
		    label: 'Date',
		    type: 'string'
		});
		$.each($scope.playersInChart, function (i, name) {
		    $scope.chart.data.cols.push({
			id: name,
			label: name,
			type: 'number'
		    });
		});

		$.each(data, function(date, scores) {
		    $scope.chart.data.rows.push(
			$scope.getChartRowFromRatings(
			    date.split(' ')[0],
			    scores
			)
		    );
		    $scope.latestScores = scores;
		});
		$scope.updateChartRanking(false);
		$scope.updateAvailablePlayers();
		$scope.chartUpdating = false;
	    })
	    .fail(function(xhr, status, error) {
		$scope.chartUpdating = false;
		alert("Error updating chart from Dartenbank: " + error);
	    });
    };

    $scope.updateChartRanking = function(replace) {
	if (! $scope.chart.data.rows) {
	     return;
	}
	if (replace) {
	    $scope.chart.data.rows.pop();
	}
	var todaysRanking = eloEngine.calc($scope.latestScores, $scope.state.ranking);
	$scope.chart.data.rows.push(
	    $scope.getChartRowFromRatings(
		'today',
		todaysRanking
	    )
	);
	//$scope.$apply();
    };

    $scope.getChartRowFromRatings = function(date, ratings) {
	var currentRow = [{v: date}];
	$.each($scope.playersInChart, function(i, player) {
	    if (player in ratings) {
		currentRow.push({v: Math.round(ratings[player])});
	    } else {
		currentRow.push({});
	    }
	});
	return {c: currentRow};
    };

    $scope.submitResult = function() {
	var ranking = {};
	$.each($scope.state.ranking, function (i, info) {
	    ranking[info['name']] = info['rank'] + 1;
	});
	urlparam = encodeURIComponent(JSON.stringify(ranking));
	window.open('http://infsec.uni-trier.de/dartenbank/input/remote-input.php?standings=' + urlparam);
    }


    $scope.sortAvailablePlayers = function() {
	$scope.availablePlayers = $filter('orderBy')($scope.availablePlayers, ['-games', '-rank']);
    };

    $scope.sortSelectedPlayers = function() {
	$scope.selectedPlayers =  $filter('orderBy')($scope.selectedPlayers, ['rank', 'name']);
	$scope.$apply();
    };

    $scope.updateAvailablePlayers = function() {
	$.ajax('http://infsec.uni-trier.de/dartenbank/rpc/get-players.php', {
	    dataType: 'JSON'
	})
	    .done(function(data) {
		$scope.availablePlayers = [];
		$scope.selectedPlayers = [];
		$.each(data, function(name, games) {
		    var rank = 1500;
		    if (typeof($scope.latestScores[name]) != 'undefined') {
			rank = $scope.latestScores[name];
		    }
		    $scope.availablePlayers.push({name: name, games: games, rank:rank});
		});
		$scope.sortAvailablePlayers();
	    });
    };

    $scope.addPlayer = function() {
	if ($scope.newPlayerName.length < 2 || $scope.newPlayerName.length > 3) {
	    alert("Player name must have 2 or 3 characters.");
	    return;
	}
	var cont = true;
	$.each($scope.availablePlayers, function(i, data) {
	    if (data.name == $scope.newPlayerName) {
		alert("Player name already exists.");
		cont = false;
	    }
	});
	if (cont) {
	    $scope.availablePlayers.push({name: $scope.newPlayerName, games: 0, rank:0});
	}
	$scope.newPlayerName = undefined;
    };

    $scope.formatDart = function(d) {
	l = d.length-1;
	if (d.substr(d.length-1, 1) == 'i') {
	    l -= 1;
	}
	d = d.substr(1, l);
	return d;
    };
    $scope.formatDartClass = function(d) {
	var mult = 'single';
	if (d.substring(0, 1) == 'D') {
	    mult = 'double';
	} else if (d.substring(0, 1) == 'T') {
	    mult = 'triple';
	}
	return 'dart ' + mult;
    }

    $scope.startEditingDarts = function(p) {
	p.editingLastDarts = true;
	if (typeof(p.last_frame.darts) === 'undefined') {
	    p.lastDartsEdited = '';
	} else {
	    p.lastDartsEdited = p.last_frame.darts.join(' ');
	}
    }

    $scope.saveDarts = function(p) {
	if (typeof(p.lastDartsEdited) === 'undefined') {
	    p.editingLastDarts = false;
	    return;
	}
	var input = p.lastDartsEdited;
	if (! /^([SDT]?(1?[0-9]|20)i?( [SDT]?(1?[0-9]|20)i?){0,2})?$/.test(input)) {
	    alert('Please adhere to the following format: ^[SDT]?(1?[0-9]|20)i?( [SDT]?(1?[0-9]|20)i?){0,2}$');
	    return;
	}
	postxhr({
	    player: p.started,
	    old_darts: p.last_frame.darts,
	    new_darts: input.split(' ')
	}, function(data) {
	    p.editingLastDarts = false;
	});
    }

    $scope.abortEditingDarts = function(p) {
	p.editingLastDarts = false;
    }

    // For debugging...
    $scope.onKeypress = function(ev) {
	if (ev.which == 100) {
	    $scope.debugging = ! $scope.debugging;
	}
    }

    $scope.debugThrowDart = function() {
	postxhr({
	    command: 'debug-throw-dart',
	    dart: $scope.debugDartValue
	});
    }

    $scope.debugNextPlayer = function() {
	postxhr({
	    command: 'debug-next-player',
	    dart: $scope.debugDartValue
	});
    }

}).directive("clickToEditDarts", function() {
    var editorTemplate = '<div class="click-to-edit">' +
	'<div ng-hide="view.editorEnabled">' +
	'{{value}} ' +
	'<a ng-click="enableEditor()"><i class="fa fa-edit"></i></a>' +
	'</div>' +
	'<div ng-show="view.editorEnabled">' +
	'<input ng-model="view.editableValue" class="form-control">' +
	'<a href="#" ng-click="save()"><i class="fa fa-check"></i></a>' +
	'<a ng-click="disableEditor()"><i class="fa fa-times"></i></a>.' +
	'</div>' +
	'</div>';

    return {
	restrict: "A",
	replace: true,
	template: editorTemplate,
	scope: {
	    value: "=clickToEdit",
	    player: "=clickToEditPlayer",
	},
	controller: function($scope) {
	    $scope.view = {
		editableValue: $scope.value,
		editorEnabled: false
	    };

	    $scope.enableEditor = function() {
		$scope.view.editorEnabled = true;
		$scope.view.editableValue = $scope.flattenDarts($scope.value);
	    };

	    $scope.flattenDarts = function(darts) {
		return darts.join(' ');
	    }

	    /*$scope.saveDarts = function(input) {
		if (! /^[SDT]?(1?[0-9]|20)( [SDT]?(1?[0-9]|20)){0,2}$/.test(input)) {
		    return false;
		}
		postxhr({
		    command: 'change-last-round',
		    player: $scope.player,
		    new_darts: input.replace(/ /g, ','));
		       });
		return true;
	    }*/

	    $scope.disableEditor = function() {
		$scope.view.editorEnabled = false;
	    };

	    $scope.save = function() {
		$scope.saveDarts($scope.view.editableValue);
		//if (res) {
		//    $scope.value = $scope.view.editableValue;
		$scope.disableEditor();
	    };
	}
    };
});
