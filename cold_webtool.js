// This is the script for the web tool that let you draw room
// outlines, waypoints and export them. Waypoints will be exported
// directly in the format of the json script processed by our
// sara_script_execution.

var imgWidth = undefined;
var imgHeight = undefined;

var mode = undefined;

var conf = undefined;

// Outlines is an array of outlines for each room. At the last point
// of each outline, the third element is the metadata {'roomId': xxx}
// for that room. (Each point is usually a 2-element array, as (x,y).)
var outlines = [[]];
var waypoints = [];
// The following is used to keep track of the set of indices that
// contains a waypoint at which the action "open door" should happen.
var waypoint_doors = {};

var canvas = document.getElementById("img-canvas");
var ctx = canvas.getContext("2d");

var fileBaseName = undefined;

var outlineStrokeSize = 2;
var waypointStrokeSize = 1;
var doorBoxRotateStep = 0.0174533; // 1 degree
var doorwayClass = "DW";

// Indicate if we are drawing door outlines.
var olDoorMode = false;
var olDoorModeStage = "WIDTH";
var currentDoor = [];  // Stores door information (width, length coordinates,
                       // width extension, length extension): [[a, b, c], w_ext, l_ext]
                       // See definition of a, b, c below in drawDoorOnCanvas
var allDoors = {};  // mapping from roomID -> door


$(document).ready(function() {

    canvas.addEventListener("mousedown", draw, false);

    $(document).on("change", "#map-img-file-selector", function() {
        var input = $(this)[0];

        if (input.files && input.files[0]) {
            var reader = new FileReader();
            reader.onload = function(e) {
                var fileTarget = $("#map-img-file-selector").prop('files')[0];

                if (fileTarget.type.startsWith("image")) {
                    // show the image
                    $("#map-img-display").attr('src', e.target.result);
                    imgWidth = $("#map-img-display").width();
                    imgHeight = $("#map-img-display").height();
                    // scroll to the center of the image
                    var y = $(window).scrollTop();
                    var x = $(window).scrollLeft();
                    $(window).scrollTop(y + (imgHeight - window.innerHeight) / 2);
                    $(window).scrollLeft(x + (imgWidth - window.innerWidth) / 2);

                    // Create a canvas tag, positioned on top of image
                    $("#img-canvas").attr('width', imgWidth);
                    $("#img-canvas").attr('height', imgHeight);

                    // Reset these variables
                    outlines = [[]];
                    waypoints = [];
                } else {
                    alert("Please upload .jpg file");
                }
            };
            reader.readAsDataURL(input.files[0]);

            fileBaseName = input.files[0].name.split(".")[0].split(" ").join("_");
        }
    });

    $(document).on("change", "#map-config-file-selector", function() {
        var input = $(this)[0];

        if (input.files && input.files[0]) {
            var reader = new FileReader();
            reader.onload = function(e) {
                var fileTarget = $("#map-config-file-selector").prop('files')[0];

                var content = e.target.result;

                $("#map-config-list").html("");  // Clear old

                // Read config file
                conf = jsyaml.load(content);
                $("#config-message").html("Load success.");
                $("#map-config-list").append("<li>resolution: " + conf['resolution'] + "</li>");
                $("#map-config-list").append("<li>gmapping origin: " + conf['origin'] + "</li>");

                $("#config-message").removeClass("alert-msg");
            };
            reader.readAsText(input.files[0]);
        }
    });

    $(document).on("click", "#map-wyp-file-selector", function(e) {
        if (!conf) {
            $("#config-message").addClass("alert-msg");
            $("#config-message").html("Config file required before loading waypoints!");
            e.preventDefault();
        }
    });

    // load waypoints
    $(document).on("change", "#map-wyp-file-selector", function() {
        var input = $(this)[0];

        if (input.files && input.files[0]) {
            var reader = new FileReader();
            reader.onload = function(e) {
                var fileTarget = $("#map-wyp-file-selector").prop('files')[0];

                var content = e.target.result;

                waypoints = [];

                // Read waypoints file. Should be the format of script_execution json file.
                waypoints_loaded = JSON.parse(content);
                // convert gmapping coordinate to pixels
                for (var i = 0; i < waypoints_loaded["script"].length; i++) {
		    var action = waypoints_loaded["script"][i];
		    if ("move" in action) {
			gwp = [action["move"]["x"], action["move"]["y"], action["move"]["th"]];
			var pwp = [
                            (gwp[0] - conf['origin'][0]) / conf['resolution'],
                            imgHeight - (gwp[1] - conf['origin'][1]) / conf['resolution']
			];
			waypoints.push(pwp);
		    } else if ("open_door" in action) {
			waypoint_doors[waypoints.length-1] = true;
		    }
                }
                redraw(); // Redraw everything
            };
            console.log(waypoints);
            reader.readAsText(input.files[0]);
        }
    });

    $(document).on("click", "#map-ol-file-selector", function(e) {
        if (!conf) {
            $("#config-message").addClass("alert-msg");
            $("#config-message").html("Config file required before loading waypoints!");
            e.preventDefault();
        }
    });

    // load existing outlines
    $(document).on("change", "#map-ol-file-selector", function() {
        var input = $(this)[0];

        if (input.files && input.files[0]) {
            var reader = new FileReader();
            reader.onload = function(e) {
                var fileTarget = $("#map-ol-file-selector").prop('files')[0];

                var content = e.target.result;

                outlines = [];

                // Read outlines file. Should be a world description file.
                var world_description = JSON.parse(content);

		// Read door information if possible. Otherwise, clear the allDoors array.
		if (world_description.hasOwnProperty('doors')) {
		    for (var roomId in world_description['doors']) {
			allDoors[roomId] = world_description['doors'][roomId];
		    }
		} else {
		    for (var roomId in allDoors) {
			delete allDoors[roomId];
		    }
		}

                // convert gmapping coordinate to pixels
		var i = 0;
		for (var roomId in world_description['rooms']) {
		    if (world_description['rooms'].hasOwnProperty(roomId)) {
			var roomInfo = world_description['rooms'][roomId];

			// NOTE: In new labels.json format, room_id or roomId is equivalent as unique_id.
			// This script handles both new and old format.
			var uniqueId = roomId;
			if ($("#old-outlines-format")[0].checked) {
			    // old version
			    uniqueId = roomInfo['unique_id'];
			}
		    
			outlines.push([]);
			for (var k = 0; k < roomInfo['outline'].length; k++) {
                            // edge in global coordinates
                            var gedge = roomInfo['outline'][k];
                            // edge point 1 in pixels coordinates
                            var pedge_p1 = [
				(gedge[0][0] - conf['origin'][0]) / conf['resolution'],
				imgHeight - (gedge[0][1] - conf['origin'][1]) / conf['resolution']
                            ];
                            outlines[i].push(pedge_p1);
			}

			// last edge in this outline in global coordinates
			var glastEdge = roomInfo['outline'][roomInfo['outline'].length-1];
			// edge point 2 on last edge pixels coordinates
			var plastEdge_p2 = [
                            (glastEdge[1][0] - conf['origin'][0]) / conf['resolution'],
                            imgHeight - (glastEdge[1][1] - conf['origin'][1]) / conf['resolution'],
			    {'roomId': uniqueId} // metadata
			];
			outlines[i].push(plastEdge_p2);
		    }
		    i += 1;
		}
                outlines.push([]);
                redraw(); // Redraw everything
                console.log(outlines);
            };
            reader.readAsText(input.files[0]);
        }
    });


    // Outline
    $(document).on("click", "#outline-btn", function() {
        if (mode !== "outline") {
            // select outline
            $(this).addClass("btn-selected");
            $("#waypoint-btn").removeClass("btn-selected");
            $("#ok-btn").prop("disabled", false);
            mode = "outline";
        } else {
            // unselect
            mode = undefined;
            $(this).removeClass("btn-selected");
            $("#ok-btn").prop("disabled", false);
        }
    });


    // Waypoint
    $(document).on("click", "#waypoint-btn", function() {
        if (mode !== "waypoint") {
            // select outline
            $(this).addClass("btn-selected");
            $("#outline-btn").removeClass("btn-selected");
            $("#ok-btn").prop("disabled", true);
            mode = "waypoint";
        } else {
            // unselect
            mode = undefined;
            $(this).removeClass("btn-selected");
            $("#ok-btn").prop("disabled", false);
        }

    });

    // When undo button is clicked, remove the last element in
    // either outlines or waypoints.
    $(document).on("click", "#undo-btn", function() {
        if (mode === "outline") {

	    // If in door mode, just redraw everything.
	    if (olDoorMode) {
		redraw();
		currentDoor = [];
		olDoorModeStage = "WIDTH";
		return;
	    }
	    
            if (outlines.length == 0) {
                // if outlines does not have any element, we want it to hve one.
                outlines.push([]);
            } else if (outlines.length == 1 && outlines[0].length == 0) {
                // if outlines has only one empty sub array, do nothing.
            } else {
                // if outlines' last element is empty, remove that array, and remove the
                // last element of the second to the last array.
                var lastOutline = outlines[outlines.length-1];

		// Now do what is said above.
		var roomId = undefined;
		
                if (lastOutline.length == 0) {
                    outlines.splice(outlines.length-1, 1);
                    var secLastOutline = outlines[outlines.length-1];
		    // secLastOutline must be a full outline
		    roomId = secLastOutline[secLastOutline.length-1][2]['roomId'];
                    secLastOutline.splice(secLastOutline.length-1, 1);
                } else {
                    // normal case. Remove the last element of the last outline
		    if (lastOutline[lastOutline.length-1] == 3) {
			roomId = lastOutline[lastOutline.length-1][2]['roomId'];
		    }
                    lastOutline.splice(lastOutline.length-1, 1);
                }

		// If we undo a full outline that is a doorway outline, remove
		// the doorway from allDoors.
		if (roomId != undefined) {
		    if (allDoors.hasOwnProperty(roomId)) {
			delete allDoors[roomId];
		    }
		}

            }
        } else if (mode === "waypoint") {
            if (waypoints.length == 0) {
                // if waypoints is empty, do nothing
            } else {
		// If waypoints.length-1 is in waypoint_doors set, then we
		// remove that key from waypoint_doors.
		if (waypoints.length-1 in waypoint_doors) {
		    delete waypoints[waypoints.length-1];
		}
                waypoints.splice(waypoints.length-1, 1);
            }
            // if waypoints is empty now, disable the door-btn.
	    if (waypoints.length == 0) {
		$("#door-btn").prop("disabled", true);
		waypoint_doors = {};
	    }
        }

        redraw();
    });

    // OK button clicked. In outline mode, this means one room outline is finished.
    // Nothing happens in waypoint mode.
    $(document).on("click", "#ok-btn", function() {
        if (mode === "outline") {
            // put a label indicating the number besides the last point in this outline
            var lastOutline = outlines[outlines.length-1];
            var lastPoint = lastOutline[lastOutline.length-1];
	    var roomId = $("#room_id_field").val();
            drawRoomLabel(outlines.length, roomId, lastPoint);
	    // We want to add metadata to the last element in the last outline in the outlines array.
	    lastOutline[lastOutline.length-1] = [lastPoint[0], lastPoint[1], {'roomId': roomId}];
            outlines.push([]);

	    incRoomId(roomId);
        }
    });

    // Export button. Output world description if in outlines mode.  Output waypoints file if
    // in waypoint mode. All in json format.
    $(document).on("click", "#export-btn", function() {
        var dataStr = undefined;

        // resolution (m / pixel) of the gmapping map should be given in config.
        if (!conf || !conf['resolution']) {
            $("#config-message").addClass("alert-msg");
            $("#config-message").html("Resolution is not loaded for this map!");
            return;
        }

        if (mode === "outline") {
            // Well, let's just output outline coordinates for now.
	    // TODO: Generate world description file directly
	    // Update: I now generate world description file
	    var world_description = {"rooms": {}};
	    
	    // Check if we save doorway information
	    if ($("#save-dw-info")[0].checked) {
		world_description["doors"] = allDoors;
	    }
	    
            // gmapping origin is the gmapping coordinate at the lower-left pixel of the map image.
            // Note that in JS Canvas coordinate system, the origin is at top-left.
            // Together with resolution, we can compute  gmapping coordinate by:
            // (gx, gy) = (originX + px*res , originY + (imgHeight - py)*res)
            for (var i = 0; i < outlines.length; i++) {
                if (outlines[i].length == 0) {
                    continue;
                }
		// edges contains an array of edges (2-element arrays)
		var edges = [];
                var pi = outlines[i][0];
                var gi = [conf['origin'][0] + pi[0]*conf['resolution'],
                          conf['origin'][1] + (imgHeight - pi[1])*conf['resolution'],
                          0.0];

                for (var j = 1; j < outlines[i].length; j++) {
                    var pt = outlines[i][j];
                    var gt = [conf['origin'][0] + pt[0]*conf['resolution'],
                              conf['origin'][1] + (imgHeight - pt[1])*conf['resolution'],
                              0.0];

                    // push edge
                    edges.push([gi, gt]);
                    gi = gt;
                }
		var roomId = "undefined";
		var lastPointOfCurrentOutline = outlines[i][outlines[i].length-1]
		if (lastPointOfCurrentOutline.length == 3) {
		    // The third element stores metadata
		    roomId = lastPointOfCurrentOutline[2]['roomId']
		}

		// Handle new and old format
		if ($("#old-outlines-format")[0].checked) {
		    // old format
		    world_description['rooms']['room_' + numToStr(i+1, 2)] = {
			"objects": {},
			"unique_id": roomId,
			"outline": edges,
		    }
		} else {
		    // new format
		    world_description['rooms'][roomId] = {
			"outline": edges,
		    }
		}
            }
	    
	    dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(world_description));
        } else if (mode === "waypoint") {
	    // Format: 
	    // { "loop": true/false,
	    //   "script": [
	    //     {
	    //      "ACTION_TYPE": { ... },
	    //     },
	    //     ...
	    //   ]
	    // }
	    // ACTION_TYPE can be "move", "open_door" (for now).
            var output = {};
	    output["loop"] = "true";  // Default loop to true. You can change it manually.
	    output["script"] = [];
            for (var i = 0; i < waypoints.length; i++) {
		// compute real world cooridnates
                var p = waypoints[i];
		var wx = conf['origin'][0] + p[0]*conf['resolution'];
		var wy = conf['origin'][1] + (imgHeight - p[1])*conf['resolution'];
		var wth = 0.0;
		// Push a new action "move" to move to this location.
		output["script"].push({
		    "move": {
			"th": wth,
			"x": wx,
			"y": wy
		    }
		})
		
		// If this index i is in waypoint_doors, we push another action
		// "open_door", with an attribute "wait" (sec) for 15 sec. There
		// should not be two consecutive "open_door" actions.
		if (i in waypoint_doors) {
		    output["script"].push({
			"open_door": {
			    "wait": 15
			}
		    });
		}
            }

            dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(output));
        }

        if (dataStr) {
            // download json file
            var downloadAnchor = document.getElementById('download-anchor-elem');
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", fileBaseName + "_" + mode + "s.json");
            downloadAnchor.click();
        }
    });


    // When clicked Move Outline button, user is in move_outline mode. He will not be
    // able to draw new outlines now (outline button will be disabled). When he presses
    // arrow buttons, the outlines as a whole moves in desired direction.
    $(document).on("click", "#outline-whole-move-btn", function() {
        if (mode === "move_outline") {
            // Disable move_outline mode
            mode = undefined;
            $("#outline-btn").prop("disabled", false);
            $(this).removeClass("btn-selected");
            return;
        }

        // Enable move_outline mode
        mode = "move_outline";
        $("#outline-btn").prop("disabled", true);
        $(this).addClass("btn-selected");
    });

    // Door button
    $(document).on("click", "#door-btn", function() {
	// Treat the last waypoint's index as the "door" index, i.e. the index
	// that "open door" action can be inserted.
	var doorIndex = waypoints.length - 1;
	waypoint_doors[doorIndex] = true;
	// Redraw so that color of the last waypoint can be updated.
	redraw();
    });

    // Outline door mode button
    $(document).on("click", "#ol-door-mode", function() {
	olDoorMode = !olDoorMode;
	if (olDoorMode) {
	    $("#ol-door-mode").addClass("btn-selected");
	} else {
	    redraw();
	    currentDoor = [];
	    olDoorModeStage = "WIDTH";
	    $("#ol-door-mode").removeClass("btn-selected");
	}
    });

    // Mass update doors
    $(document).on("click", "#ol-mass-update-doors", function() {
	if (!olDoorMode) {
	    alert("Click `Door Mode` to enable this feature.");
	    return;
	}
	var wx = $("#door-width-ext").val() / conf['resolution'];
	var lx = $("#door-length-ext").val() / conf['resolution'];

	doorCorners = {}
	for (var roomId in allDoors) {
	    var door = allDoors[roomId];
	    var corners = extendDoor(door, wx, lx);
	    doorCorners[roomId] = corners;
	}

	// Now, update the outlines and redraw.
	for (var i = 0; i < outlines.length; i++) {
	    if (outlines[i].length == 0) {
		continue;
	    }
	    var lastPoint = outlines[i][outlines[i].length-1];
	    var roomId = lastPoint[2]['roomId'];
	    if (doorCorners.hasOwnProperty(roomId)) {
		var doorOl = createDoorOutline(doorCorners[roomId], roomId);
		outlines[i] = doorOl.slice();
	    }
	}
	redraw();
    });

    // Arrow keys control for moving outline
    $(document).keydown(function(e) {
        if (mode === "move_outline") {
            if (e.keyCode === 65) {  // 'a' === LEFT
		shiftOutlines(-2, 0);
            } else if (e.keyCode === 87)  {  // 'w' === UP
		shiftOutlines(0, -2);
            } else if (e.keyCode === 68)  {  // 'd' === RIGHT
		shiftOutlines(2, 0);
            } else if (e.keyCode === 83)  {  // 's' === DOWN
		shiftOutlines(0, 2);
            }
            redraw();
	} else if (mode === "outline" && olDoorMode == true) {
	    if (currentDoor.length == 0 || currentDoor[0].length == 1) {
		return;
	    }

	    var step = 0;
	    if (e.keyCode === 87) {  // 'w' === UP
		step = -doorBoxRotateStep;
	    } else if (e.keyCode === 83){  // 's' === DOWN
		step = doorBoxRotateStep;
	    } else {
		return;
	    }
	    redraw();
	    
	    // rotate the dots in currentDoor[0]
	    for (var i = 0; i < currentDoor[0].length; i++) {
		if (i != 0) {
		    var p = currentDoor[0][i];
		    var p_rot = rotateAround(p, currentDoor[0][0], step);
		    currentDoor[0][i][0] = p_rot[0];
		    currentDoor[0][i][1] = p_rot[1];
		}

		drawDot(currentDoor[0][i][0], currentDoor[0][i][1], radius, "#68d153", ctx);
	    }
	    var a = currentDoor[0][0];
	    var b = currentDoor[0][1];
	    drawLine(a[0], a[1], b[0], b[1], outlineStrokeSize, "#8bf975", ctx);
	    if (currentDoor[0].length > 2) {
		var c = currentDoor[0][2];
		var d = currentDoor[0][3];
		drawDot(c[0], c[1], radius, "#68153", ctx);    // Draw c
		drawDot(d[0], d[1], radius, "#68153", ctx);    // Draw d
		drawLine(a[0], a[1], c[0], c[1], outlineStrokeSize, "#f78976", ctx);
		drawLine(b[0], b[1], d[0], d[1], outlineStrokeSize, "#f78976", ctx);
		drawLine(c[0], c[1], d[0], d[1], outlineStrokeSize, "#8bf975", ctx);
	    }
	}
    });

});  // end $document.ready


// canvas add keyboard event



function draw(event) {
    // Fired when mousedown

    var canvas_x = event.pageX;
    var canvas_y = event.pageY;

    // if in outlines mode, append this point to the last subarray in outlines
    if (mode === "outline") {

	// If in doormode, handle it differently.
	if (olDoorMode) {
	    drawDoorOnCanvas(canvas_x, canvas_y, ctx, currentDoor);
	} else {
	
            var rectSize = outlineStrokeSize;
            ctx.fillStyle="#0066ff";
            ctx.strokeStyle="#0066ff";
            ctx.lineWidth = rectSize;

            var curOutline = outlines[outlines.length-1];
            // If this is the first point in the new outline, draw rect. Otherwise, use lineTo.
            if (curOutline.length == 0) {
		ctx.fillRect(canvas_x - rectSize/2, canvas_y - rectSize/2, rectSize, rectSize);
            } else {
		var lastPoint = curOutline[curOutline.length-1];
		ctx.beginPath();
		ctx.moveTo(lastPoint[0], lastPoint[1]);
		ctx.lineTo(canvas_x, canvas_y);
		ctx.stroke();
            }
            curOutline.push([canvas_x, canvas_y]);  // x, y, metadata
	}
    } else if (mode === "waypoint") {   // waypoint mode
        var radius = waypointStrokeSize;
        ctx.fillStyle = "#cc33ff";
        ctx.strokeStyle="rgba(204, 51, 255, 0.5)";
        ctx.lineWidth = waypointStrokeSize;

        ctx.beginPath();
        ctx.arc(canvas_x, canvas_y, radius, 0, 2*Math.PI);
        ctx.fill();

        // Draw a thiner line connecting the new point
        if (waypoints.length > 0) {
            var lastPoint = waypoints[waypoints.length-1];
            ctx.beginPath();
            ctx.moveTo(lastPoint[0], lastPoint[1]);
            ctx.lineTo(canvas_x, canvas_y);
            ctx.stroke();
        }

        waypoints.push([canvas_x, canvas_y]);

	// enable door button
	$("#door-btn").prop("disabled", false);

	// For debugging
	// alert("(" + (conf['origin'][0] + canvas_x*conf['resolution']) + ", " +
        //       (conf['origin'][1] + (imgHeight - canvas_y)*conf['resolution']) + ")");

    }

}

// redraw outlines and waypoints
function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawOutlines(outlines);
    drawWaypoints(waypoints);
}

function drawOutlines(olines) {
    var rectSize = outlineStrokeSize;
    ctx.fillStyle = "#0066ff";
    ctx.strokeStyle = "#0066ff";
    ctx.lineWidth = rectSize;

    var k = 0;
    olines.forEach(function(outline) {
        if (outline.length >= 1) {
            var prevPoint = outline[0];
            ctx.fillRect(prevPoint[0] - rectSize/2, prevPoint[1] - rectSize/2, rectSize, rectSize);

            if (outline.length >= 2) {

                for (var i = 1; i < outline.length; i++) {
                    var curPoint = outline[i];
                    ctx.beginPath();
                    ctx.moveTo(prevPoint[0], prevPoint[1]);
                    ctx.lineTo(curPoint[0], curPoint[1]);
                    ctx.stroke();

                    prevPoint = curPoint;
                }
            }
            if (k < olines.length - 1) {
		// This means we are finished drawing the points of an outline. If k
		// is less than to olines.length - 1 (which is supposed to be an empty
		// array IF the last outline is full), then we should plot a label for
		// the k-th room.
		var roomId = prevPoint[2]['roomId'];
		drawRoomLabel(k+1, roomId, prevPoint);
            }
        }
        k = k+1;
    });
}

function drawWaypoints(wpoints) {
    if (wpoints.length == 0) {
        return;
    }
    var radius = waypointStrokeSize;
    ctx.fillStyle = "#cc33ff";
    ctx.strokeStyle="rgba(204, 51, 255, 0.5)";
    ctx.lineWidth = waypointStrokeSize;

    // draw the first point
    var prevPoint = wpoints[0];
    ctx.beginPath();
    ctx.arc(prevPoint[0], prevPoint[1], radius, 0, 2*Math.PI);
    ctx.fill();

    // draw the rest
    for (var i = 1; i < wpoints.length; i++) {	
        var waypoint = wpoints[i];

	if (i in waypoint_doors) {
	    // If i is in waypoint_doors, color should be different.
	    ctx.fillStyle = "#00ff99";
	    ctx.strokeStyle="rgba(0, 255, 153, 0.5)";
	}
        ctx.beginPath();
        ctx.arc(waypoint[0], waypoint[1], radius, 0, 2*Math.PI);
        ctx.fill();

	// Reset color of stroke
	ctx.fillStyle = "#cc33ff";
	ctx.strokeStyle="rgba(204, 51, 255, 0.5)";

        ctx.beginPath();
        ctx.moveTo(prevPoint[0], prevPoint[1]);
        ctx.lineTo(waypoint[0], waypoint[1]);
        ctx.stroke();

        prevPoint = waypoint;
    }
}

function drawRoomLabel(num, roomId, point) {
    var text = num + ". " + roomId;
    var fontSize = 13;
    var numWidth = (num+". ").length*(fontSize/2.8);
    var roomIdWidth = (roomId + " ").length*(fontSize/1.72);
    
    var rectHeight = fontSize + 10;
    var rectWidth = numWidth + roomIdWidth;

    var coordX = point[0] - outlineStrokeSize * 3 - rectWidth / 1.5;
    var coordY = point[1] + outlineStrokeSize * 3;

    ctx.fillStyle = "#ffed7c";
    ctx.globalAlpha = 0.4
    ctx.fillRect(coordX, coordY, rectWidth, rectHeight);
    ctx.globalAlpha = 1.0

    // num (only draw if we use old format)
    if ($("#old-outlines-format")[0].checked) {
	ctx.fillStyle = "#181919";
	ctx.font = fontSize + "px Arial";
	ctx.fillText(num + ". ", coordX + 4, coordY + fontSize*1.15);
    } else {
	numWidth = 0;  // Forget about the numerical index (new format).
    }

    // roomid
    ctx.fillStyle = "#29179E";
    ctx.font = "bold " + fontSize + "px Arial";
    ctx.fillText(roomId, coordX + 4 + numWidth, coordY + fontSize*1.15);
}


function shiftOutlines(dx, dy) {
    // Simply change the coordinates of each point in outlines array. dx, dy
    // both should have pixel as unit.
    for (var i = 0; i < outlines.length; i++) {
        var outline = outlines[i];
        for (var k = 0; k < outline.length; k++) {
            outline[k][0] += dx;
            outline[k][1] += dy;
        }
    }
}

function numToStr(num, n_digits) {
    // Does nothing if number of digits in num is greater than n_digits.
    var string = num + "";
    if (string.length <= n_digits) {
	var diff = n_digits - string.length;
	for (var i = 0; i < diff; i++) {
	    string = "0" + string
	}
	return string
    }
    return ""
}

// currentDoor: Stores door information (width, length coordinates,
// width extension, length extension): [[w1, w2], [l1, l2], w_ext, l_ext]
function drawDoorOnCanvas(cx, cy, ctx, currentDoor) {
    if (conf === undefined) {
	alert("Load map yaml file.");
	return;
    }
    if (imgHeight === undefined) {
	alert("Load map png file.");
	return;
    }
    if (outlines[outlines.length-1].length != 0) {
	alert("You have a pending room outline. Click OK before entering door mode");
	return;
    }

    // a--------c (length)
    // |
    // |(width)
    // |
    // b
    
    radius = outlineStrokeSize + 2;
    switch(olDoorModeStage) {
    case "WIDTH":
	if (currentDoor.length == 0) {
	    currentDoor.push([[cx, cy]]);
	    // Draw a dot
	    drawDot(cx, cy, radius, "#68d153", ctx);    // Draw a dot

	} else if (currentDoor[0].length == 1) {
	    currentDoor[0].push([cx, cy]);
	    // Draw a dot
	    drawDot(cx, cy, radius, "#68d153", ctx);    // Draw a dot
	    
	    // Draw a line for width
	    var lastPoint = currentDoor[0][0];
	    drawLine(lastPoint[0], lastPoint[1], cx, cy, outlineStrokeSize, "#8bf975", ctx);
	    
	    // Record width in the parameter field
	    var width = pixelDistToGmappingDist([cx, cy], lastPoint, conf['origin'], conf['resolution'], imgHeight);
	    $("#door-width").val(width.toFixed(2));
	    
	    // Change stage
	    olDoorModeStage = "LENGTH";
	} else {
	    alert("Error! Wrong stage! A");
	}
	break;
	
    case "LENGTH":
	if (currentDoor[0].length == 2) {

	    // We want a line that is perpendicular to line a-b. Yet the user probably didn't provide
	    // a point that meets this requirement. So we interpolate the perpendicular line based on
	    // what the user drew.
	    var a = currentDoor[0][0];
	    var b = currentDoor[0][1];
	    var c0 = [cx, cy];   // the original c point that the user clicked on.
	    var length = pixelDistToGmappingDist(c0, a, conf['origin'], conf['resolution'], imgHeight);

	    var pos = checkDotSignOnLine(a, b, c0);
	    	    
	    var c = solveForPerpPoint(a, b, length/conf['resolution'], pos);
	    var d = solveForPerpPoint(b, a, length/conf['resolution'], pos);
	    
	    currentDoor[0].push([c[0], c[1]]);
	    currentDoor[0].push([d[0], d[1]]);
	    drawDot(c[0], c[1], radius, "#68153", ctx);    // Draw c
	    drawDot(d[0], d[1], radius, "#68153", ctx);    // Draw d

	    // Connect the dots
	    drawLine(a[0], a[1], c[0], c[1], outlineStrokeSize, "#f78976", ctx);
	    drawLine(b[0], b[1], d[0], d[1], outlineStrokeSize, "#f78976", ctx);
	    drawLine(c[0], c[1], d[0], d[1], outlineStrokeSize, "#8bf975", ctx);
	    
	    // Record width in the parameter field
	    $("#door-length").val(length.toFixed(2));

	    // Change stage
	    olDoorModeStage = "OK";
	} else {
	    alert("Error! Wrong stage! B");
	}
	break;

    case "OK":
	if (currentDoor[0].length != 4) {
	    alert("Error! Wrong stage! C");
	    break;
	}
	
	// After the user drew the width and length, they just click anywhere and a door is added.
	var wx = $("#door-width-ext").val() / conf['resolution'];
	var lx = $("#door-length-ext").val() / conf['resolution'];
	
	var corners = extendDoor(currentDoor, wx, lx);
	// For debugging
	// var A = corners[0];
	// var B = corners[1];
	// var C = corners[2];
	// var D = corners[3];
	// drawDot(A[0], A[1], radius, "blue", ctx);    // Draw c
	// drawDot(B[0], B[1], radius, "red", ctx);    // Draw d
	// drawDot(C[0], C[1], radius, "green", ctx);    // Draw d
	// drawDot(D[0], D[1], radius, "purple", ctx);    // Draw d
	// // Connect the points
	// drawLine(A[0], A[1], B[0], B[1], outlineStrokeSize, "#773cb2", ctx);
	// drawLine(A[0], A[1], C[0], C[1], outlineStrokeSize, "#773cb2", ctx);
	// drawLine(D[0], D[1], B[0], B[1], outlineStrokeSize, "#773cb2", ctx);
	// drawLine(D[0], D[1], C[0], C[1], outlineStrokeSize, "#773cb2", ctx);

	// Add new outline
	var roomId = $("#room_id_field").val();
	outlines[outlines.length-1] = createDoorOutline(corners, roomId);
	outlines.push([]);
	incRoomId(roomId);

	// Finish up this door
	currentDoor.push(wx);
	currentDoor.push(lx);
	
	// Reset state
	olDoorModeStage = "WIDTH";

	// Add a door to allDoors
	allDoors[roomId] = currentDoor.slice();

	// Reset currentDoor to be empty.
	currentDoor.length = 0;

	// redraw
	redraw();
	
	break;
	
    default:
    }
}

function drawDot(x, y, radius, fillStyle, ctx) {
    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2*Math.PI);
    ctx.fill();
}

function drawLine(x1, y1, x2, y2, width, style, ctx) {
    ctx.lineWidth = width;
    ctx.strokeStyle = style;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}

function gmappingToPixel(gx, gy, origin, resolution, imgHeight) {
    var px = (gx - origin[0]) / resolution;
    var py = imgHeight - (gy - origin[1]) / resolution;
    return [px, py];
}

function pixelToGmapping(px, py, origin, resolution, imgHeight) {
    var gx = origin[0] + px*resolution;
    var gy = origin[1] + (imgHeight - py)*resolution;
    return [gx, gy];
}

function pixelDistToGmappingDist(p1, p2, origin, resolution, imgHeight) {
    var pdist = Math.sqrt((p1[0]-p2[0])*(p1[0]-p2[0]) + (p1[1]-p2[1])*(p1[1]-p2[1]));
    return pdist * resolution;
}

// Dot product of two 2D points.
function dotProduct(u, v) {
    return u[0]*v[0] + u[1]*v[1];
}

// Given two 2D points, return a vector a-->b
function vect(a, b) {
    return [b[0] - a[0], b[1] - a[1]];
}

function scale(v, s) {
    return [v[0]*s, v[1]*s];
}

function norm(a) {
    return Math.sqrt(a[0]*a[0] + a[1]*a[1]);
}

function unitvect(v) {
    return scale(v, 1.0/norm(v));
}

function checkDotSignOnLine(a, b, c0) {
    // Return 'true' (positive) if the normal vector of line(a,b) dot (c0-a) is positive.
    // Otherwise, return 'false' (negative).
    //
    // We define the normal vector of line(a,b) as the vector perpendicular to line(a,b) and
    // has positive y component.

    // Compute normal vector to line(a,b): (dy, -dx) and (-dy, dx)
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var n = undefined;
    if (dx > 0) {
	n = [-dy, dx];
    } else {
	n = [dy, -dx];
    }
    return dotProduct(vect(a,c0), n) > 0;
}

// Given two known points a, b on a line, and a distance L, compute the coordinates
// of the point that lies on a line perpendicular to line a-b, going through point a, and has
// distance L from a.
// The parameter `pos` is a boolean. It affects the position of the resulting point c, as shown
// below.
function solveForPerpPoint(a, b, L, pos=true) {
    // c (neg)
    // |
    // |
    // |
    // a ------- b
    // |    | (norm)
    // |    v
    // |
    // c (pos)
    if (b[0]-a[0] == 0) {
	if (pos) {
	    return [a[0] + L, a[1]];
	} else {
	    return [a[0] - L, a[1]];
	}
    } else {
	var k = -((b[1]-a[1])/(b[0]-a[0]));
	var diff_y = Math.sqrt(L*L / (1 + k*k));
	var cx = 0.0, cy = 0.0;

	if (pos) {
	    cy = a[1] + diff_y;
	    cx = a[0] + k*diff_y;
	} else {
	    cy = a[1] - diff_y;
	    cx = a[0] - k*diff_y;
	}
	return [cx, cy];
    }
}

// Given four points of a rectangle, compute the change of basis matrix that transforms from
// standard R2 basis to the basis defined by two orthogonal vectors of this rectangle.
// The returned matrix is row-major, 1D array:
// [
//   e,  f,
//   g,  h
// ]
function changeOfBasisMatrix(a, b, c, d) {
    var co1 = unitvect(vect(c, d));
    var co2 = unitvect(vect(c, a));
    return [co1[0], co2[0], co1[1], co2[1]];
}

function inverse2by2(M) {
    var scalar = 1.0 / (M[0]*M[3] - M[1]*M[2]);
    return [
	scalar*M[3], scalar*-M[1],
	scalar*-M[2], scalar*M[0]
    ];
}

// Convert a point in one basis to another.
// v is the point, P is the change of basis matrix.
function rebase(v, P) {
    return [
	P[0]*v[0] + P[1]*v[1],
	P[2]*v[0] + P[3]*v[1],
    ];
}

// a is the un-extended corner point (in std basis). P is the change of basis matrix from std to
// rect. Q is the change of basis matrix from rect to std. dx, dy are displacement over the first
// and second dimension of the rect basis. We assume that the lower-left corner of the rectangle
// that P is defined on is the origin of the basis of the rectangle.
function computeCorner(a_S, P, Q, dx_R, dy_R) {
    var a_R = rebase(a_S, Q);
    var c_R = [a_R[0] + dx_R, a_R[1] + dy_R];  // corner point in rect basis
    var c_S = rebase(c_R, P);
    return c_S;
}

// Given a door, extend its corners by wx (width extension) and lx (length extension). Does not
// change the 2nd and 3rd element in the door.
function extendDoor(door, wx, lx) {
    var a = door[0][0];
    var b = door[0][1];
    var c = door[0][2];
    var d = door[0][3];
    
    // We know determine the actual boundaries of the doorway, considering the
    // extensions.
    // A--e             B
    // |  | lx
    // f--a----------b
    //  wx|          |
    //    |          |wx
    //    c----------d--f
    //            lx |  |
    // C             e--D

    // P is the change of basis matrix from std to
    // rect. Q is the change of basis matrix from rect to std.
    var P = changeOfBasisMatrix(a, b, c, d);
    var Q = inverse2by2(P);
    
    var A = computeCorner(a, P, Q, -wx, lx);
    var B = computeCorner(b, P, Q, wx, lx);
    var C = computeCorner(c, P, Q, -wx, -lx);
    var D = computeCorner(d, P, Q, wx, -lx);
    return [A, B, C, D];
}

function createDoorOutline(corners, roomId) {
    // A---B
    // |   |
    // C---D
    var A = corners[0];
    var B = corners[1];
    var C = corners[2];
    var D = corners[3];

    return [A, B, D, C, [A[0], A[1], {'roomId': roomId}]]
}

// increment room id by 1.
function incRoomId(roomId) {
    // For convenience, increment the count of third element in roomId.
    var parts = roomId.split('-');
    if (parts.length == 3) {
	parts[2] = parseInt(parts[2]) + 1;
	$("#room_id_field").val(parts.join("-"));
    }
}

// Computes Y=AB. Requires that matrix A is mxn, matrix B is nxr. Returns Y.
function matXmat(A, B, m, n, r) {
    var Y = [];
    for (var i = 0; i < m; i++) {
	for (var j = 0; j < r; j++) {
	    var sum = 0.0;
	    for (var k = 0; k < n; k++) {
		sum += A[i*m+k] * B[k*r+j];
	    }
	    Y.push(sum);
	}
    }
    return Y;
}

// Return a matrix that does affine translation by given vector v.
function affine_translate(v) {
    return [
	1, 0, v[0],
	0, 1, v[1],
	0, 0, 1
    ];
}

// Return a matrix that does affine rotation around the origin by given angle theta (radian).
function affine_rotate(theta) {
    return [
	Math.cos(theta), -Math.sin(theta), 0,
	Math.sin(theta),  Math.cos(theta), 0,
	0,                0,               1
    ];
}


// Rotate point p around point q by angle theta (radian).
function rotateAround(p, q, theta) {
    // We are doing the following:
    // 1. Translate q to origin   T(q)
    // 2. Rotate                  R(theta)
    // 3. Translate back          T(-q)
    // Combined: T(-q)R(theta)T(q)

    var Tq = affine_translate(q);
    var Rt = affine_rotate(theta);
    var Tnq = affine_translate([-q[0], -q[1]]);

    var M = matXmat(matXmat(Tq,Rt,3,3,3), Tnq,3,3,3);

    var pa = [p[0], p[1], 1];
    var p_rot = matXmat(M, pa, 3, 3, 1);
    return p_rot;
}
